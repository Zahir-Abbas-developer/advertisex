#!/usr/bin/env node
/**
 * storagetest — Phase 10: file storage works on both drivers, with no server
 * running. The S3 driver is exercised against an in-memory S3 stand-in that
 * checks every request is SigV4-signed for the configured key and region;
 * the local driver against a temporary directory.
 *
 *   npm run storagetest
 */

import http from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
let checks = 0;
function check(ok, label, detail = "") {
  checks += 1;
  if (ok) return console.log(`  ✓ ${label}`), true;
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}
const serverModule = async (p) => {
  const m = await import(p);
  return m.default ?? m;
};

/** Just enough S3: PUT/GET/DELETE on /bucket/key, SigV4 checked for shape and credential. */
function fakeS3(accessKeyId, region) {
  const objects = new Map();
  const seen = [];
  const server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    const signed = auth.startsWith("AWS4-HMAC-SHA256 ") && auth.includes(`Credential=${accessKeyId}/`) && auth.includes(`/${region}/s3/aws4_request`) && /Signature=[0-9a-f]{64}/.test(auth) && Boolean(req.headers["x-amz-date"]) && Boolean(req.headers["x-amz-content-sha256"]);
    seen.push({ method: req.method, url: req.url, signed });
    if (!signed) return res.writeHead(403).end("<Error><Code>AccessDenied</Code></Error>");
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "PUT") {
        objects.set(req.url, { body: Buffer.concat(chunks), type: req.headers["content-type"] });
        return res.writeHead(200).end();
      }
      if (req.method === "GET") {
        const o = objects.get(req.url);
        return o ? res.writeHead(200, { "content-type": o.type }).end(o.body) : res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
      }
      if (req.method === "DELETE") {
        objects.delete(req.url);
        return res.writeHead(204).end();
      }
      res.writeHead(405).end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, objects, seen, endpoint: `http://127.0.0.1:${server.address().port}` })));
}

async function main() {
  const { s3Storage, storageFor, isSafeName } = await serverModule("../lib/storage.ts");
  const name = "3f2b8c1e-6d4a-4f7e-9a1b-2c3d4e5f6a7b.pdf";
  const bytes = Buffer.from("%PDF-1.7 a small test file");

  console.log("\nS3-COMPATIBLE");
  const s3 = await fakeS3("AKIDEXAMPLE", "auto");
  try {
    const store = s3Storage({ bucket: "advertisex-files", region: "auto", endpoint: s3.endpoint, accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret", prefix: "org-1" });
    await store.put(name, bytes, "application/pdf");
    check(s3.objects.has(`/advertisex-files/org-1/${name}`), "PUT lands at bucket/prefix/name (path-style)", [...s3.objects.keys()].join(","));
    check(s3.seen.every((r) => r.signed), "every request is SigV4-signed with the configured key and region");
    check(Buffer.compare((await store.get(name)) ?? Buffer.alloc(0), bytes) === 0, "GET returns the same bytes");
    check((await store.get("00000000-0000-0000-0000-000000000000.pdf")) === null, "a missing object reads as null, not an error");
    await store.delete(name);
    check(!s3.objects.has(`/advertisex-files/org-1/${name}`) && (await store.get(name)) === null, "DELETE removes it");
    const wrong = s3Storage({ bucket: "advertisex-files", region: "auto", endpoint: s3.endpoint, accessKeyId: "SOMEONEELSE", secretAccessKey: "x" });
    let refused = false;
    await wrong.put(name, bytes, "application/pdf").catch(() => (refused = true));
    check(refused, "a store that rejects the credentials fails loudly");
  } finally {
    s3.server.close();
  }

  console.log("\nLOCAL DISK");
  const dir = mkdtempSync(path.join(os.tmpdir(), "advx-store-"));
  try {
    const local = storageFor({ NODE_ENV: "development", STORAGE_DRIVER: "local", UPLOAD_DIR: dir });
    check(local?.driver === "local", "STORAGE_DRIVER=local picks the disk");
    await local.put(name, bytes, "application/pdf");
    check(readdirSync(dir).includes(name) && Buffer.compare(await local.get(name), bytes) === 0, "round-trips a file in the directory");
    let escaped = false;
    await local.put("../escape.pdf", bytes, "application/pdf").catch(() => (escaped = true));
    check(escaped && !readdirSync(path.dirname(dir)).includes("escape.pdf"), "a name with path structure can't leave the directory");
    await local.delete(name);
    check(!readdirSync(dir).includes(name), "deletes");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("\nCONFIGURATION");
  check(storageFor({ NODE_ENV: "production" }) === null, "production with no bucket has no store — uploads fail loudly, never onto a vanishing disk");
  check(storageFor({ NODE_ENV: "production", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" })?.driver === "s3", "a bucket and credentials select S3");
  check(storageFor({ NODE_ENV: "production", STORAGE_DRIVER: "local" })?.driver === "local", "a self-hosted server can opt into its disk explicitly");
  check(storageFor({ NODE_ENV: "development" })?.driver === "local", "development defaults to the local directory");
  check(isSafeName(name) && isSafeName("ckx1a2b3c4d5e6f7g8h9i0j1k.docx") && !isSafeName("../x.pdf") && !isSafeName("a/b.pdf") && !isSafeName("x.pdf") && !isSafeName(".env"), "only generated names are accepted");

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
