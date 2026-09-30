/**
 * Finishes a vault key rotation (docs/RUNBOOK.md → "Rotate the vault key").
 *
 * With VAULT_KEY set to the new key and VAULT_KEY_PREVIOUS to the old one,
 * the app already opens both and seals new secrets with the new key. This
 * re-seals every stored secret still under an older key, so the old key can
 * then be removed. Dry run by default; `-- --apply` writes. Each secret stays
 * bound to its record (the AAD), and nothing is ever printed but counts.
 *
 *   VAULT_KEY=… VAULT_KEY_PREVIOUS=… DATABASE_URL=… npm run vault:reseal [-- --apply]
 */
import { PrismaClient } from "@prisma/client";

import { keyIdOf, open, seal } from "../modules/vault/cipher";
import { vaultKeys } from "../modules/vault/keys";

async function main() {
  const apply = process.argv.includes("--apply");
  const { keys, development } = vaultKeys();
  if (development) throw new Error("VAULT_KEY isn't set — this only makes sense against a real vault key.");
  const current = keys[0];
  const currentId = keyIdOf(current);
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.clientCredential.findMany({ select: { id: true, secret: true } });
    const stale = rows.filter((r) => r.secret.split(".")[1] !== currentId);
    console.log(`${rows.length} secrets; ${stale.length} under an older key${apply ? "" : " (dry run — add -- --apply to re-seal)"}`);
    // Open everything first: if any secret can't be opened with the keys given,
    // write nothing — a half-rotated vault is worse than an unrotated one.
    const opened: { id: string; plain: string }[] = [];
    const unreadable: string[] = [];
    for (const r of stale) {
      try {
        opened.push({ id: r.id, plain: open(r.secret, keys, r.id) });
      } catch {
        unreadable.push(r.id);
      }
    }
    if (unreadable.length) {
      console.error(`${unreadable.length} secret(s) can't be opened with VAULT_KEY or VAULT_KEY_PREVIOUS — set the key they were sealed with. Nothing was changed.`);
      process.exitCode = 1;
      return;
    }
    if (!apply) return;
    for (const r of opened) await prisma.clientCredential.update({ where: { id: r.id }, data: { secret: seal(r.plain, current, r.id) } });
    console.log(`re-sealed ${opened.length}. When this reports 0 under an older key, remove VAULT_KEY_PREVIOUS.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
