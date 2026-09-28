#!/usr/bin/env node
/**
 * bundle-scan — after `npm run build`, proves the browser bundles carry none
 * of the vault: no key material, no key derivation, no cipher, no signing
 * salt, no demo secret — nor the AI or payment providers (Phase 5, 7) or the
 * server-side PDF engine. (Phase 4 acceptance: "never present in the client
 * bundle".) The static import-graph test (tests/client-boundary.test.ts) is
 * the first wall; this checks what was actually shipped.
 *
 *   npm run build && npm run bundlescan
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), ".next", "static");
const NEEDLES = ["VAULT_KEY", "advertisex-dev-vault", "aes-256-gcm", "sealSecret", "openSecret", "advertisex:file-urls", "FILE_URL_SECRET", "Nonna-Demo-2026", "api.anthropic.com", "api.stripe.com", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "PDFDocument"];

if (!existsSync(ROOT)) {
  console.error("No .next/static — run `npm run build` first.");
  process.exit(1);
}
const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(path.join(dir, n)).isDirectory() ? files(path.join(dir, n)) : [path.join(dir, n)]));
const hits = [];
let scanned = 0;
for (const file of files(ROOT).filter((f) => /\.(js|css|json|map)$/.test(f))) {
  const text = readFileSync(file, "utf8");
  scanned++;
  for (const n of NEEDLES) if (text.includes(n)) hits.push(`${path.relative(process.cwd(), file)} contains "${n}"`);
}
console.log(`${scanned} browser files scanned for vault, AI, payments and PDF-engine markers`);
if (hits.length) {
  for (const h of hits) console.error(`  ✗ ${h}`);
  process.exit(1);
}
console.log("✓ nothing of the vault, the AI provider, the payment provider or the PDF engine reached the browser bundle");
