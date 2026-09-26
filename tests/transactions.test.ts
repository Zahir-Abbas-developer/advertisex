import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Interactive transactions go through `transaction()` in lib/prisma.ts, which
 * keeps the audit trail honest (entries written after commit, dropped on
 * rollback). A direct `prisma.$transaction(async (tx) => …)` bypasses that:
 * its audit writes happen outside the transaction — deadlocking on SQLite,
 * committing phantom entries on Postgres. The array form is fine.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("transactions", () => {
  it("use transaction(), never an interactive prisma.$transaction directly", () => {
    const offenders = ["app", "lib", "modules", "components"]
      .flatMap(files)
      .filter((f) => path.normalize(f) !== path.normalize("lib/prisma.ts"))
      .filter((f) => /\$transaction\(\s*async/.test(readFileSync(f, "utf8")));
    assert.deepEqual(offenders, []);
  });
});
