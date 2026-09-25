#!/usr/bin/env node
/**
 * `prisma migrate deploy`, with a one-time baseline for databases that predate
 * the migration history.
 *
 * Production was synced with `prisma db push` until Phase 1 (risk R1), so it
 * has every table but no `_prisma_migrations` ledger. Running `migrate deploy`
 * cold would try to re-create everything and fail on the first table. The fix
 * is Prisma's own baselining flow: mark `00000000000000_baseline` as applied —
 * it describes exactly the state db push left behind — then deploy for real,
 * which applies only what comes after it.
 *
 * `migrate resolve --applied` only writes a row to the ledger. It never
 * executes the baseline's SQL, so no table on the live database is touched by
 * the baseline step itself; only the migrations *after* it run.
 *
 * Idempotent: once the ledger records the baseline, the resolve step is
 * skipped forever. A genuinely empty database skips it too, so a fresh
 * environment gets the baseline executed rather than skipped.
 *
 * ## The one-time baseline is gated on a confirmed backup
 *
 * Baselining a populated database is the one step that cannot be rehearsed on
 * the real thing, so it refuses to run until someone has taken a backup and
 * says so: set BASELINE_BACKUP_CONFIRMED=1 for that one deploy. Without it the
 * build fails before touching anything, and Vercel keeps serving the previous
 * deployment. Once the ledger exists the variable is irrelevant and can be
 * removed. Empty databases and already-baselined ones never need it.
 *
 * Uses DATABASE_URL as given — the caller (vercel-build, db:deploy) points it
 * at the right database, unpooled where required.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const BASELINE = "00000000000000_baseline";

function run(command) {
  console.log(`migrate-deploy: ${command}`);
  execSync(command, { stdio: "inherit" });
}

const prisma = new PrismaClient();
try {
  // Does the database already have tables, but no record of the baseline?
  const [tables, ledger] = await Promise.all([
    prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'User'`,
    ),
    prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = '_prisma_migrations'`,
    ),
  ]);
  const hasSchema = Number(tables[0]?.n ?? 0) > 0;
  let baselined = false;
  if (Number(ledger[0]?.n ?? 0) > 0) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "_prisma_migrations"
       WHERE migration_name = '${BASELINE}' AND finished_at IS NOT NULL`,
    );
    baselined = Number(rows[0]?.n ?? 0) > 0;
  }

  if (hasSchema && !baselined) {
    if (process.env.BASELINE_BACKUP_CONFIRMED !== "1") {
      console.error(
        "migrate-deploy: REFUSING to baseline — this database has tables but no\n" +
          "migration ledger, and BASELINE_BACKUP_CONFIRMED is not set.\n" +
          "Take a backup (a Neon branch or pg_dump), then set\n" +
          "BASELINE_BACKUP_CONFIRMED=1 for this one deploy. Nothing was changed.",
      );
      process.exitCode = 1;
      throw new Error("baseline not confirmed");
    }
    console.log("migrate-deploy: existing schema without a ledger — baselining (backup confirmed)");
    run(`npx prisma migrate resolve --applied ${BASELINE}`);
  }
} catch (error) {
  if (error instanceof Error && error.message === "baseline not confirmed") {
    await prisma.$disconnect();
    process.exit(1);
  }
  throw error;
} finally {
  await prisma.$disconnect();
}

run("npx prisma migrate deploy");
