import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

import { avatarColorFor } from "../lib/constants";

/**
 * Production seed: the owner account, and the service catalogue. Nothing else.
 *
 * `npm run db:seed` creates a demo agency — five clients, fifty-five
 * milestones, invented people. That is exactly what you do not want in a
 * production database, so production gets this instead.
 *
 * Credentials come from the environment and are validated rather than
 * defaulted: shipping with admin/admin123 because someone forgot a variable is
 * the failure mode worth designing against.
 *
 *   ADMIN_EMAIL="you@agency.com" ADMIN_PASSWORD="…" ADMIN_NAME="Your Name" \
 *     npm run db:seed:admin
 */

const prisma = new PrismaClient();

/** Rejected outright — these exist in the demo seed and in every wordlist. */
const BANNED_PASSWORDS = new Set([
  "admin123",
  "member123",
  "password",
  "password123",
  "changeme",
  "letmein",
]);

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Agency Owner";
  const jobTitle = process.env.ADMIN_JOB_TITLE?.trim() || "Agency Owner";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    fail("Set ADMIN_EMAIL to a valid email address.");
  }
  if (!password) {
    fail("Set ADMIN_PASSWORD.");
  }
  if (password.length < 12) {
    fail("ADMIN_PASSWORD must be at least 12 characters for a production owner.");
  }
  if (BANNED_PASSWORDS.has(password.toLowerCase())) {
    fail("That password is one of the demo or well-known defaults. Pick another.");
  }

  // The service catalog is seeded per organization by prisma/seed.ts (which
  // every deploy runs), from modules/services/catalog.ts.

  const existing = await prisma.user.findUnique({ where: { email } });

  // Every account belongs to an organization — the data layer refuses a
  // tenant-less principal — so the owner joins organization #1.
  const org = await prisma.organization.upsert({
    where: { slug: "advertisex" },
    update: {},
    create: { slug: "advertisex", name: "Advertise X" },
  });

  const owner = await prisma.user.upsert({
    where: { email },
    // An existing owner keeps their password; this script is not a reset tool.
    update: { role: "FOUNDER", isActive: true, organizationId: existing?.organizationId ?? org.id },
    create: {
      organizationId: org.id,
      name,
      email,
      jobTitle,
      role: "FOUNDER",
      passwordHash: await bcrypt.hash(password, 12),
      // The password arrived through an environment variable, so it has been
      // seen by at least one other system; the owner replaces it on first
      // sign-in (Phase 0 risk R3).
      mustChangePassword: true,
      avatarColor: avatarColorFor(email),
      isActive: true,
    },
  });

  const line = "─".repeat(58);
  console.log(`\n${line}`);
  console.log("  Advertise X — production seed");
  console.log(line);
  console.log(`  Owner       ${owner.email}`);
  console.log(`  Password    ${existing ? "unchanged (account already existed)" : "as provided"}`);
  console.log(`${line}\n`);
  console.log("  Sign in, then add your team from /team.\n");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
