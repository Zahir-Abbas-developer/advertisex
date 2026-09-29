/**
 * The type a browser declares is the uploader's claim. For the types we
 * preview or that have an unambiguous signature, the file's first bytes must
 * agree (Phase 10) — a script renamed .png is refused, not stored.
 */
const SIGNATURES: Record<string, (b: Uint8Array) => boolean> = {
  "image/png": (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/gif": (b) => String.fromCharCode(...b.slice(0, 6)) === "GIF87a" || String.fromCharCode(...b.slice(0, 6)) === "GIF89a",
  "image/webp": (b) => String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
  "application/pdf": (b) => String.fromCharCode(...b.slice(0, 5)) === "%PDF-",
  "application/zip": (b) => b[0] === 0x50 && b[1] === 0x4b,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => b[0] === 0x50 && b[1] === 0x4b,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b) => b[0] === 0x50 && b[1] === 0x4b,
  "application/msword": (b) => [0xd0, 0xcf, 0x11, 0xe0].every((x, i) => b[i] === x),
  "application/vnd.ms-excel": (b) => [0xd0, 0xcf, 0x11, 0xe0].every((x, i) => b[i] === x),
};

/** Pure: do these leading bytes match the declared type? Types without a signature (text) pass. */
export function signatureMatches(mimeType: string, head: Uint8Array): boolean {
  const check = SIGNATURES[mimeType];
  return check ? check(head) : true;
}
