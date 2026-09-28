import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import defaultTheme from "tailwindcss/defaultTheme";

import config from "../tailwind.config";

/**
 * Guards for the design tokens themselves.
 *
 * A color token that shares a name with a Tailwind font size produces a class
 * like `text-base` that compiles, looks right in review, and quietly sets
 * 16px type instead of a color. That shipped once — every gold button had
 * white text — so the collision is now a failing test rather than something
 * to spot by eye.
 */

const colors = Object.keys(config.theme?.extend?.colors ?? {});
const fontSizes = new Set([
  ...Object.keys(defaultTheme.fontSize),
  ...Object.keys(config.theme?.extend?.fontSize ?? {}),
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts|css)$/.test(name) ? [full] : [];
  });
}

describe("design tokens", () => {
  it("defines the §7 core tokens", () => {
    for (const token of ["canvas", "surface", "ink", "on-brand", "line", "brand", "data", "green", "gray", "teal", "success", "warn", "danger", "info"]) {
      assert.ok(colors.includes(token), `missing color token: ${token}`);
    }
  });

  it("never names a color token after a font size", () => {
    const clashes = colors.filter((name) => fontSizes.has(name));
    assert.deepEqual(clashes, [], `color tokens shadowed by text-<size>: ${clashes.join(", ")}`);
  });

  it("uses no retired light-theme tokens in the UI", () => {
    // Also a full-strength `border-ink`: ink is the darkest green, so an
    // unfaded ink border is a heavy outline — panels use `line-strong`.
    const retired = /\b(?:bg|text|border|ring|ring-offset)-(?:paper|cream)\b|\bbg-white\b|\bbg-base\b|\bborder-ink(?![\w/-])/;
    const offenders = ["app", "components"]
      .flatMap(sourceFiles)
      .filter((file) => retired.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(process.cwd(), file));
    assert.deepEqual(offenders, []);
  });
});

// ---------------------------------------------------------------------------
// Forest & Mint (CLAUDE.md §7, ADR-017)
// ---------------------------------------------------------------------------

/** The founder's palette — exact, from forest-mint-theme.css. Never edited. */
const PALETTE: Record<string, string> = {
  "green-950": "#022313",
  "green-800": "#0E5B37",
  "green-600": "#279D61",
  "green-400": "#51B883",
  "green-200": "#9BD4B4",
  "green-100": "#CEE4D9",
  "green-50": "#E7F4EB",
  white: "#FFFFFF",
  "gray-50": "#F8F8FB",
  "gray-100": "#F1F1F4",
  "gray-300": "#CBCBCD",
  "gray-400": "#AFB0B1",
  "gray-600": "#656565",
  "chart-fill": "#D5E0DC",
  "teal-500": "#50A6BC",
};

const hexOf = (triple: string) =>
  `#${triple.trim().split(/\s+/).map((n) => Number(n).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** Every class-bearing string literal in the UI, with its file. */
function literals(): { file: string; text: string }[] {
  return ["app", "components"].flatMap(sourceFiles).flatMap((file) => {
    const src = readFileSync(file, "utf8");
    return [...src.matchAll(/"[^"\n]*"|`[^`]*`|'[^'\n]*'/g)].map((m) => ({ file: path.relative(process.cwd(), file), text: m[0] }));
  });
}

describe("Forest & Mint", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const vars = Object.fromEntries([...css.matchAll(/--c-([\w-]+):\s*([\d\s]+);/g)].map((m) => [m[1], hexOf(m[2])]));

  it("uses the founder's palette exactly — every value, to the digit", () => {
    for (const [name, hex] of Object.entries(PALETTE)) assert.equal(vars[name], hex, `--c-${name}`);
  });

  it("gives charts the same values (components/charts/theme.ts)", async () => {
    const { PALETTE: chart } = await import("../components/charts/theme");
    const pairs: [string, string][] = [
      ["green950", "green-950"], ["green800", "green-800"], ["green600", "green-600"], ["green400", "green-400"],
      ["green200", "green-200"], ["green100", "green-100"], ["green50", "green-50"], ["white", "white"],
      ["gray50", "gray-50"], ["gray100", "gray-100"], ["gray300", "gray-300"], ["gray400", "gray-400"],
      ["gray600", "gray-600"], ["chartFill", "chart-fill"], ["teal500", "teal-500"],
    ];
    for (const [key, name] of pairs) assert.equal((chart as Record<string, string>)[key].toUpperCase(), PALETTE[name], key);
  });

  it("never sets text in green-600 or lighter, teal, or the data series", () => {
    // Icons may carry the hue (the rule is about text): a literal that sizes
    // an icon, or the two icon-chip tone maps, is allowed.
    const ICON_CHIP_FILES = new Set(["components/ui/StatCard.tsx", "components/layout/NotificationBell.tsx"]);
    const forbidden = /(?<![\w-])(?:[\w-]+:)*text-(?:green-(?:600|400|200|100|50)|teal-500|data-(?!negative\b)[\w]+|success|info|warn)(?![\w-])/;
    const offenders = literals()
      .filter(({ file, text }) => forbidden.test(text))
      .filter(({ file, text }) => !ICON_CHIP_FILES.has(file) && !/\bh-[\d.[\]px]+ w-|fill-/.test(text))
      .map(({ file, text }) => `${file}: ${text.slice(0, 80)}`);
    assert.deepEqual(offenders, []);
  });

  it("never colors text with a light green or teal in emails, error pages or PDFs", () => {
    const light = /(?<![\w-])color:\s*["'`]?\s*#(?:279D61|51B883|9BD4B4|CEE4D9|E7F4EB|50A6BC)\b/i;
    const files = ["lib/email/templates.ts", "app/global-error.tsx", "public/offline.html", "modules/portal/invite-email.ts", "modules/billing/email.ts"];
    const offenders = files.filter((f) => light.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders, []);
  });

  it("shows negative data in gray, never red", async () => {
    const { CHART } = await import("../components/charts/theme");
    assert.ok(!Object.values(CHART).some((v) => /#(?:DC2626|EF4444)/i.test(String(v))), "the chart theme has no red");
    assert.equal(CHART.negative, PALETTE["gray-600"]);
    const { SCORE_BANDS } = await import("../lib/scoring");
    assert.equal(SCORE_BANDS.find((b) => b.key === "CRITICAL")?.color, PALETTE["gray-600"], "a low score is data: gray");
    // A delta/trend/points branch that falls through to red.
    const redNegative = /(?:<\s*0|delta|trend|points|negative|down)[^;\n]{0,60}text-danger/;
    const offenders = ["app", "components"].flatMap(sourceFiles).filter((f) => redNegative.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders.map((f) => path.relative(process.cwd(), f)), []);
  });

  it("uses only palette shades — no stock Tailwind colors, no off-palette steps", () => {
    const stock = /\b(?:bg|text|border|fill|stroke|from|to|via|ring|divide|outline|accent|decoration)-(?:slate|zinc|neutral|stone|red|orange|amber|yellow|lime|emerald|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+/;
    const offShade = /\b(?:bg|text|border|fill|stroke|from|to|via|ring)-(?:green-(?!(?:950|800|600|400|200|100|50)\b)\d+|gray-(?!(?:50|100|300|400|600)\b)\d+|teal-(?!500\b)\d+)/;
    const offenders = ["app", "components"]
      .flatMap(sourceFiles)
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return stock.test(src) || offShade.test(src);
      })
      .map((f) => path.relative(process.cwd(), f));
    assert.deepEqual(offenders, []);
  });

  it("keeps the Obsidian & Gold hexes out of the product", () => {
    const old = /#(?:0B0B0D|121215|18181C|F5F3EE|D4AF37|E5C558|2DD4BF|818CF8|F472B6)\b/i;
    const offenders = ["app", "components", "lib", "modules"]
      .flatMap(sourceFiles)
      .filter((f) => !f.endsWith("lib/constants.ts")) // the legacy avatar map, display-only
      .filter((f) => old.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f));
    assert.deepEqual(offenders, []);
  });
});
