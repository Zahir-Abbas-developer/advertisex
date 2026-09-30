import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { AwsClient } from "aws4fetch";

/**
 * Where uploaded and generated files live (Phase 10) — one small interface,
 * two drivers:
 *
 *   - `s3`: any S3-compatible bucket (AWS S3, Cloudflare R2, Supabase
 *     Storage, MinIO), signed with SigV4. Required on serverless hosts, whose
 *     disk is read-only and temporary.
 *   - `local`: a directory on the server's disk — development, or a
 *     self-hosted server with a real, backed-up disk.
 *
 * Chosen by STORAGE_DRIVER; with it unset, `s3` when S3_BUCKET is set, else
 * `local` in development. In production, an unset driver without a bucket is
 * refused rather than defaulting to a disk that may silently lose files.
 *
 * Names are server-generated (`<uuid>.<ext>`) and validated here again, so no
 * caller-supplied string ever becomes a path or an object key.
 */

export interface Storage {
  readonly driver: "local" | "s3";
  put(name: string, bytes: Buffer, contentType: string): Promise<void>;
  get(name: string): Promise<Buffer | null>;
  delete(name: string): Promise<void>;
}

export class StorageNotConfiguredError extends Error {
  constructor() {
    super("File storage isn't configured: set S3_BUCKET (and credentials), or STORAGE_DRIVER=local on a server with a persistent disk.");
  }
}

/** A stored name: generated, flat, no path structure. */
export const isSafeName = (name: string) => /^[A-Za-z0-9-]{8,64}\.[a-z0-9]{2,5}$/.test(name);

export const LOCAL_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(process.cwd(), "uploads");

function localStorage(root = LOCAL_DIR): Storage {
  const target = (name: string) => {
    const file = path.resolve(root, name);
    // Belt and braces: even a safe name must stay inside the directory.
    return file.startsWith(`${path.resolve(root)}${path.sep}`) ? file : null;
  };
  return {
    driver: "local",
    async put(name, bytes) {
      const file = target(name);
      if (!file) throw new Error("Unsafe storage name");
      await mkdir(root, { recursive: true });
      await writeFile(file, bytes);
    },
    async get(name) {
      const file = target(name);
      if (!file) return null;
      return readFile(file).catch(() => null);
    },
    async delete(name) {
      const file = target(name);
      if (file) await unlink(file).catch(() => undefined);
    },
  };
}

export type S3Config = { bucket: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string; prefix?: string };

export function s3Storage(config: S3Config): Storage {
  const client = new AwsClient({ accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: config.region, service: "s3", retries: 3 });
  // Path-style (endpoint/bucket/key) works with every S3-compatible service;
  // AWS itself also accepts it.
  const base = (config.endpoint ?? `https://s3.${config.region}.amazonaws.com`).replace(/\/$/, "");
  const url = (name: string) => `${base}/${encodeURIComponent(config.bucket)}/${config.prefix ? `${config.prefix.replace(/\/$/, "")}/` : ""}${encodeURIComponent(name)}`;
  return {
    driver: "s3",
    async put(name, bytes, contentType) {
      const res = await client.fetch(url(name), { method: "PUT", body: new Uint8Array(bytes), headers: { "Content-Type": contentType } });
      if (!res.ok) throw new Error(`Storage refused the file (${res.status})`);
    },
    async get(name) {
      const res = await client.fetch(url(name), { method: "GET" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
      return Buffer.from(await res.arrayBuffer());
    },
    async delete(name) {
      const res = await client.fetch(url(name), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status})`);
    },
  };
}

/** The configured driver, or null when production has none. Pure over `env`, for tests and the health check. */
export function storageFor(env: NodeJS.ProcessEnv = process.env): Storage | null {
  const driver = env.STORAGE_DRIVER ?? (env.S3_BUCKET ? "s3" : env.NODE_ENV === "production" ? null : "local");
  if (driver === "local") return localStorage(env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : LOCAL_DIR);
  if (driver === "s3" && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    return s3Storage({ bucket: env.S3_BUCKET, region: env.S3_REGION ?? "auto", endpoint: env.S3_ENDPOINT, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, prefix: env.S3_PREFIX });
  }
  return null;
}

let cached: Storage | null | undefined;
export function storage(): Storage {
  if (cached === undefined) cached = storageFor();
  if (!cached) throw new StorageNotConfiguredError();
  return cached;
}
