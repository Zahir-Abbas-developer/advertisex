import { PrismaClient } from "@prisma/client";

import { LEGACY_ROLES } from "../config/permissions";
import { LEGACY_TASK_STATUSES } from "../modules/tasks/domain";

/**
 * The *contract* step of the vocabulary renames (ADR-008, ADR-011).
 *
 * Rewrites every legacy role string (ADMIN, SUPPORT_ADMIN, MEMBER) and every
 * legacy task status (OPEN, DONE) to its current name. Run it only once the
 * deployment that reads both vocabularies is live and verified — never inside
 * `vercel-build`, where it would rewrite them underneath the previous
 * deployment while it is still serving.
 *
 * Safe to run twice: the second run finds nothing to change. Each role change
 * is audit-logged per account; task statuses are a rename with no meaning
 * change, so they are rewritten in bulk. Prints a dry run unless `--apply`.
 *
 *   npm run roles:backfill            # show what would change
 *   npm run roles:backfill -- --apply # change it
 */

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

async function main() {
  const legacy = await prisma.user.findMany({
    where: { role: { in: Object.keys(LEGACY_ROLES) } },
    select: { id: true, email: true, role: true },
    orderBy: { email: "asc" },
  });

  const tasks = await prisma.task.groupBy({
    by: ["status"],
    where: { status: { in: Object.keys(LEGACY_TASK_STATUSES) } },
    _count: true,
  });
  for (const row of tasks) {
    console.log(`  tasks with status ${row.status.padEnd(6)} ${String(row._count).padStart(5)}  -> ${LEGACY_TASK_STATUSES[row.status]}`);
  }

  if (legacy.length === 0 && tasks.length === 0) {
    console.log("roles:backfill — nothing to do; every account and task already uses the current names.");
    return;
  }

  for (const user of legacy) {
    console.log(`  ${user.email.padEnd(32)} ${user.role.padEnd(14)} -> ${LEGACY_ROLES[user.role]}`);
  }

  if (!apply) {
    console.log(`\n${legacy.length} account(s) and ${tasks.reduce((t, r) => t + r._count, 0)} task(s) would change. Re-run with --apply to write.`);
    return;
  }

  for (const [legacyStatus, current] of Object.entries(LEGACY_TASK_STATUSES)) {
    await prisma.task.updateMany({ where: { status: legacyStatus }, data: { status: current } });
  }

  await prisma.$transaction(
    legacy.flatMap((user) => [
      prisma.user.update({ where: { id: user.id }, data: { role: LEGACY_ROLES[user.role] } }),
      prisma.auditLog.create({
        data: {
          actorId: null,
          action: "ROLE_CHANGED",
          entityType: "User",
          entityId: user.id,
          summary: `Role renamed ${user.role} → ${LEGACY_ROLES[user.role]} (role backfill, ADR-008)`,
          beforeJson: JSON.stringify({ role: user.role }),
          afterJson: JSON.stringify({ role: LEGACY_ROLES[user.role] }),
        },
      }),
    ]),
  );
  console.log(`\n${legacy.length} account(s) updated.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
