/**
 * Generates the PWA icon set.
 *
 * Hand-rolled rather than pulled from a dependency: the mark is a rounded
 * square in the brand green with the wordmark "A" knocked out of it, which is
 * a handful of polygons and a rounded-rectangle test. Adding an image library
 * to the build for that would cost more than it saves, and the icons then
 * inherit the palette in CLAUDE.md automatically instead of drifting from it.
 *
 * Run with: node scripts/generate-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "icons");

// The fixed palette, from CLAUDE.md.
const BRAND = [0x1a, 0x6b, 0x3a];
const PAPER = [0xfa, 0xfa, 0xf7];

/** CRC-32, needed for every PNG chunk. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encodes RGBA pixel data as a PNG. */
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Inside a rounded rectangle? Used for the tile and for the glyph strokes. */
function inRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Signed area test, for the two diagonal strokes of the A. */
function inTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/**
 * The "A" of the Advertise X wordmark: two legs meeting at an apex with a
 * crossbar, drawn as polygons so it scales cleanly to any size.
 *
 * It replaces the "M" of the Metroctopus era. The sidebar, the login panel and the mobile
 * bar all show an "A" tile, and an installed app whose home-screen icon carries
 * a different letter from the app it opens reads as two different products.
 */
function inGlyph(x, y, size, inset) {
  const s = size - inset * 2;
  const u = (v) => inset + v * s;

  const top = u(0.16);
  const foot = u(0.84);
  const left = u(0.16);
  const right = u(0.84);
  const stem = 0.16 * s;

  const apexX = u(0.5);
  const apexHalf = stem * 0.48; // slightly narrower at the point
  const footW = stem * 1.12;    // slightly wider at the feet

  // Each leg is a quadrilateral from the shared apex band down to its foot,
  // split into two triangles for the point-in test.
  const legs = [
    [
      [apexX - apexHalf, top],
      [apexX + apexHalf, top],
      [left + footW, foot],
      [left, foot],
    ],
    [
      [apexX - apexHalf, top],
      [apexX + apexHalf, top],
      [right, foot],
      [right - footW, foot],
    ],
  ];

  for (const [p0, p1, p2, p3] of legs) {
    if (inTriangle(x, y, p0, p1, p2) || inTriangle(x, y, p0, p2, p3)) return true;
  }

  // The crossbar. Its ends tuck under the legs, so any small overshoot is
  // swallowed by the filled shapes rather than visible.
  const barTop = u(0.60);
  return inRoundedRect(x, y, u(0.31), barTop, u(0.69), barTop + stem * 0.72, stem * 0.1);
}

/**
 * Draws one icon.
 *
 * `maskable` fills the whole canvas and shrinks the glyph into the safe zone,
 * because Android crops maskable icons to whatever shape the launcher uses.
 */
function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const tileInset = maskable ? 0 : Math.round(size * 0.06);
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const glyphInset = maskable ? Math.round(size * 0.26) : Math.round(size * 0.2);

  // Supersample, so the diagonals don't stair-step.
  const SAMPLES = 3;
  const step = 1 / (SAMPLES + 1);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let tile = 0;
      let glyph = 0;

      for (let sy = 1; sy <= SAMPLES; sy += 1) {
        for (let sx = 1; sx <= SAMPLES; sx += 1) {
          const px = x + sx * step;
          const py = y + sy * step;

          const insideTile =
            maskable ||
            inRoundedRect(px, py, tileInset, tileInset, size - tileInset, size - tileInset, radius);
          if (!insideTile) continue;
          tile += 1;
          if (inGlyph(px, py, size, glyphInset)) glyph += 1;
        }
      }

      const total = SAMPLES * SAMPLES;
      const tileAlpha = tile / total;
      const glyphAlpha = glyph / total;

      // Paper over brand, brand over transparency.
      const r = BRAND[0] + (PAPER[0] - BRAND[0]) * (glyphAlpha / Math.max(tileAlpha, 1e-6));
      const g = BRAND[1] + (PAPER[1] - BRAND[1]) * (glyphAlpha / Math.max(tileAlpha, 1e-6));
      const b = BRAND[2] + (PAPER[2] - BRAND[2]) * (glyphAlpha / Math.max(tileAlpha, 1e-6));

      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(Math.min(255, Math.max(0, r)));
      rgba[offset + 1] = Math.round(Math.min(255, Math.max(0, g)));
      rgba[offset + 2] = Math.round(Math.min(255, Math.max(0, b)));
      rgba[offset + 3] = Math.round(tileAlpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(OUT, { recursive: true });

const written = [];
for (const size of [192, 512]) {
  const name = `icon-${size}.png`;
  writeFileSync(join(OUT, name), drawIcon(size));
  written.push(name);
}
for (const size of [192, 512]) {
  const name = `maskable-${size}.png`;
  writeFileSync(join(OUT, name), drawIcon(size, { maskable: true }));
  written.push(name);
}
// Apple ignores the manifest and reads this one from a <link> tag.
writeFileSync(join(OUT, "apple-touch-icon.png"), drawIcon(180, { maskable: true }));
written.push("apple-touch-icon.png");

console.log(`icons written to public/icons: ${written.join(", ")}`);
