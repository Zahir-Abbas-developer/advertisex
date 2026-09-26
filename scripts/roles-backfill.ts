import { PrismaClient } from "@prisma/client";

import { LEGACY_ROLES } from "../config/permissions";

/**
 * The *contract* step of the role rename (ADR-008).
 *
 * Rewrites every legacy role string (ADMIN, SUPPORT_ADMIN, MEMBER) to its
 * current name. Run it only once the deployment that reads both vocabularies
 * is live and verified — never inside `vercel-build`, where it would rewrite
 * roles underneath the previous deployment while it is still serving.
 *
 * Safe to run twice: the second run finds nothing to change. Each rewrite is
 * audit-logged. Prints a dry run unless `--apply` is passed.
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

  if (legacy.length === 0) {
    console.log("roles:backfill — nothing to do; every account already uses the current role names.");
    return;
  }

  for (const user of legacy) {
    console.log(`  ${user.email.padEnd(32)} ${user.role.padEnd(14)} -> ${LEGACY_ROLES[user.role]}`);
  }

  if (!apply) {
    console.log(`\n${legacy.length} account(s) would change. Re-run with --apply to write.`);
    return;
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
