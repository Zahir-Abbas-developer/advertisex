import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * The credentials vault's cipher — AES-256-GCM, pure (the key is passed in),
 * so it is unit-testable without the environment. `modules/vault/server.ts`
 * is the only caller that holds the real key.
 *
 * Sealed form: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts).
 *   - keyId: first 8 hex chars of SHA-256(key), so a rotated key can be told
 *     apart from the old one and both can be tried during a rotation.
 *   - aad: the record the secret belongs to. A sealed value copied onto
 *     another record (another client, another tenant) fails to open.
 */

const VERSION = "v1";
const b64 = (buf: Buffer) => buf.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

export class VaultError extends Error {}

export function keyIdOf(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function parseKey(raw: string): Buffer {
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== 32) throw new VaultError("A vault key must be 32 bytes, base64-encoded");
  return key;
}

export function seal(plaintext: string, key: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, keyIdOf(key), b64(iv), b64(cipher.getAuthTag()), b64(ct)].join(".");
}

/** Opens a sealed value with whichever of `keys` sealed it. Throws on any tampering. */
export function open(sealed: string, keys: readonly Buffer[], aad: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new VaultError("Not a sealed vault value");
  const [, kid, iv, tag, ct] = parts;
  const key = keys.find((k) => keyIdOf(k) === kid);
  if (!key) throw new VaultError("Sealed with a key this server doesn't hold");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, unb64(iv));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(unb64(tag));
    return Buffer.concat([decipher.update(unb64(ct)), decipher.final()]).toString("utf8");
  } catch {
    throw new VaultError("The sealed value failed its integrity check");
  }
}

/**
 * What the UI shows instead of a secret. Fixed length: revealing even the
 * length or the last characters of a password narrows a guess.
 */
export const MASK = "••••••••••";
