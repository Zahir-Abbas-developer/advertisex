import { createHash } from "node:crypto";

import { parseKey } from "@/modules/vault/cipher";

/**
 * The vault's keys, from the environment (used by modules/vault/server.ts,
 * and by the demo seed, which runs outside Next).
 *
 *   VAULT_KEY           32 random bytes, base64 — seals every new secret.
 *   VAULT_KEY_PREVIOUS  optional — the key being rotated out, still opens.
 *
 * Production without VAULT_KEY refuses. Development falls back to a key
 * derived from NEXTAUTH_SECRET so a fresh checkout works; secrets sealed that
 * way are only as safe as the dev secret — fine for demo data, never prod.
 */
export function vaultKeys(env: NodeJS.ProcessEnv = process.env): { keys: Buffer[]; development: boolean } {
  if (env.VAULT_KEY) {
    return { keys: [parseKey(env.VAULT_KEY), ...(env.VAULT_KEY_PREVIOUS ? [parseKey(env.VAULT_KEY_PREVIOUS)] : [])], development: false };
  }
  if (env.NODE_ENV === "production") throw new Error("VAULT_KEY is not set — the credentials vault is unavailable");
  return { keys: [createHash("sha256").update(`advertisex-dev-vault:${env.NEXTAUTH_SECRET ?? ""}`).digest()], development: true };
}
