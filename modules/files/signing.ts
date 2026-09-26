import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed file URLs (Phase 4 scope 5) — pure, the secret passed in.
 *
 * A signed URL grants one file, one disposition, until one moment — the same
 * contract as an S3 presigned URL, so moving storage to a bucket swaps what
 * the URL points at, not how the app hands them out. Access is decided when
 * the URL is issued (modules/files/server.ts); the raw route only checks the
 * signature and the clock.
 */

export type Disposition = "inline" | "attachment";

/** How long an issued URL works. Short: long enough to open, useless if pasted later. */
export const SIGNED_URL_TTL_SECONDS = 5 * 60;

const payload = (fileId: string, expires: number, disposition: Disposition) => `${fileId}.${expires}.${disposition}`;

export function signFile(fileId: string, expires: number, disposition: Disposition, secret: Buffer): string {
  return createHmac("sha256", secret).update(payload(fileId, expires, disposition)).digest("base64url");
}

export function verifyFileSignature(input: {
  fileId: string;
  expires: number;
  disposition: string;
  signature: string;
  secret: Buffer;
  now: number;
}): boolean {
  if (input.disposition !== "inline" && input.disposition !== "attachment") return false;
  if (!Number.isFinite(input.expires) || input.expires * 1000 < input.now) return false;
  const expected = Buffer.from(signFile(input.fileId, input.expires, input.disposition, input.secret));
  const given = Buffer.from(input.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Types a browser may render inline safely (never HTML or SVG — not accepted at all). */
export const PREVIEWABLE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"]);

export const canPreview = (mimeType: string) => PREVIEWABLE.has(mimeType);
