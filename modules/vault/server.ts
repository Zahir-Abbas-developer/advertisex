import "server-only";

import { logger } from "@/lib/logger";
import { open, seal } from "@/modules/vault/cipher";
import { vaultKeys } from "@/modules/vault/keys";

/**
 * The vault on the server only: `server-only` makes importing this from a
 * client component a build error, so neither the key nor the code that uses
 * it can reach a browser bundle. Keys: modules/vault/keys.ts.
 */
let warned = false;
function keys(): Buffer[] {
  const { keys, development } = vaultKeys();
  if (development && !warned) {
    logger.warn("vault.dev_key", { note: "VAULT_KEY unset; using a development key" });
    warned = true;
  }
  return keys;
}

/** Seals a secret for one credential record (`recordId` binds it there). */
export function sealSecret(plaintext: string, recordId: string): string {
  return seal(plaintext, keys()[0], recordId);
}

export function openSecret(sealed: string, recordId: string): string {
  return open(sealed, keys(), recordId);
}
