import { PrismaClient } from "@prisma/client";

import { auditBuffer, withAudit } from "@/modules/audit/extension";
import { withTenancy } from "@/modules/tenancy/extension";

/**
 * A single Prisma client per process. Next.js dev mode re-evaluates modules on
 * every hot reload, which would otherwise open a new connection pool each time.
 *
 * Logging is warn-and-above rather than error-and-above on purpose. Several
 * flows here rely on a unique constraint firing — re-running the evaluation
 * job, regenerating a report, raising the same deadline notice twice — and
 * Prisma logs every one of those at error level before throwing, even though
 * the caller catches it and treats it as the expected outcome. Left on, a
 * healthy production log fills with "errors" that are the idempotency working.
 * Genuine failures are still surfaced: every catch here logs what it swallowed.
 */
function createClient() {
  const base = new PrismaClient({ log: ["warn"] });
  // Every query the app makes passes through both walls: tenancy scopes it to
  // the caller's organization, audit records it if it changed a business
  // entity. Nothing outside this file holds the bare client.
  return base.$extends(withTenancy(base)).$extends(withAudit(base));
}

type AppPrismaClient = ReturnType<typeof createClient>;

const globalForPrisma = globalThis as unknown as {
  prisma: AppPrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type TransactionClient = Parameters<Parameters<AppPrismaClient["$transaction"]>[0]>[0];

/**
 * An interactive transaction that keeps the audit trail honest: every audit
 * entry produced inside it is written after it commits, and none are written
 * if it rolls back. Use this instead of `prisma.$transaction(async (tx) => …)`
 * (the array form needs nothing: it makes no mid-transaction audit queries).
 */
export async function transaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options?: { timeout?: number; maxWait?: number },
): Promise<T> {
  const buffer: Parameters<typeof auditBuffer.run>[0] = [];
  const result = await auditBuffer.run(buffer, () => prisma.$transaction(fn, options));
  if (buffer.length > 0) {
    try {
      await prisma.auditLog.createMany({ data: buffer });
    } catch (error) {
      // Same contract as every audit write: never fail the change it records.
      console.error("[audit] could not write buffered entries", error);
    }
  }
  return result;
}
