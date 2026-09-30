import "server-only";

import { signatureMatches } from "@/lib/upload-signatures";
import { LOCAL_DIR, isSafeName, storage } from "@/lib/storage";

/**
 * Upload rules, over the configured store (lib/storage: S3-compatible in
 * production, a local directory in development).
 *
 * Everything here is written defensively, because upload handling is where
 * this kind of app usually goes wrong:
 *
 *   - The stored name is server-generated. The original filename is display
 *     data only and never touches a path, so "../../.env" is just a label.
 *   - Reads resolve the path and verify it is still inside the upload
 *     directory before opening anything.
 *   - Only an allowlist of types is accepted, and everything is served back
 *     with a fixed content type plus nosniff, so an uploaded .svg or .html
 *     can't execute in the app's origin.
 *
 * Where the bytes go is lib/storage's business; this module decides what
 * may be stored and under what name.
 *
 * Marked server-only: importing it from a client component would drag node:fs
 * into the browser bundle, which is exactly how this broke the first time.
 * Display helpers like formatBytes live in lib/utils.ts instead.
 */

/** The local driver's directory (development). */
export const UPLOAD_DIR = LOCAL_DIR;

/** 10 MB — comfortably more than a design comp, far less than a video. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Accepted types, mapped to the extension used on disk. SVG is deliberately
 * absent: it is script-capable, and nothing here needs it.
 */
export const ALLOWED_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};

export function isAllowedType(mimeType: string): boolean {
  return Object.hasOwn(ALLOWED_TYPES, mimeType);
}

/** An allowed type whose content agrees with it. */
export async function isAllowedFile(file: Blob & { type: string }): Promise<boolean> {
  if (!isAllowedType(file.type)) return false;
  return signatureMatches(file.type, new Uint8Array(await file.slice(0, 16).arrayBuffer()));
}

export function extensionFor(mimeType: string): string {
  return ALLOWED_TYPES[mimeType] ?? "bin";
}

/** Writes the bytes under a generated name and returns that name. */
export async function save(id: string, mimeType: string, bytes: Buffer): Promise<string> {
  const storedName = `${id}.${extensionFor(mimeType)}`;
  await storage().put(storedName, bytes, mimeType);
  return storedName;
}

/**
 * Reads a stored file. Returns null rather than throwing when the name isn't
 * one we generate (no path structure can ever reach the store) or the file is
 * missing.
 */
export async function read(storedName: string): Promise<Buffer | null> {
  if (!isSafeName(storedName)) return null;
  return storage().get(storedName);
}

/** Deletes a stored file's bytes. Missing or unsafe names are a no-op. */
export async function remove(storedName: string): Promise<void> {
  if (!isSafeName(storedName)) return;
  await storage().delete(storedName);
}
