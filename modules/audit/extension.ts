import { Prisma, type PrismaClient } from "@prisma/client";

import { actorTypeFor, buildAuditEntry, isAudited } from "@/modules/audit/entry";
import { requestActor } from "@/modules/tenancy/context";
import { logger, errorFields } from "@/lib/logger";

/**
 * Audit logging wired into the data layer (Phase 1, scope 9): every create,
 * update and delete of a business entity writes an AuditLog row, whichever
 * code path made it.
 *
 * Single-row updates and deletes read the row first so the entry carries a
 * before-image; the read goes through the *base* client, so it is neither
 * scoped nor audited itself.
 *
 * Never throws into its caller — the same contract as `lib/audit.ts`. A
 * failed audit write must not roll back the change it was recording; it is
 * logged loudly instead.
 */

const SNAPSHOT_OPERATIONS = new Set(["update", "delete", "upsert"]);

type Delegate = { findUnique: (args: { where: unknown }) => Promise<unknown> };

export function withAudit(base: PrismaClient) {
  return Prisma.defineExtension({
    name: "audit",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!isAudited(model, operation)) return query(args);

          const input = args as Record<string, unknown> | undefined;
          let before: unknown = null;
          if (SNAPSHOT_OPERATIONS.has(operation) && input?.where) {
            const delegate = (base as unknown as Record<string, Delegate>)[
              model.charAt(0).toLowerCase() + model.slice(1)
            ];
            before = await delegate?.findUnique({ where: input.where }).catch(() => null);
          }

          const result = await query(args);

          try {
            const actor = await requestActor(base);
            const entry = buildAuditEntry({
              model,
              operation,
              args: input,
              before,
              result,
              actor: {
                id: actor?.userId ?? null,
                type: actorTypeFor(actor?.role),
                organizationId: actor?.organizationId ?? null,
              },
            });
            if (entry) await base.auditLog.create({ data: entry });
          } catch (error) {
            logger.error("audit.write_failed", { model, operation, ...errorFields(error) });
          }

          return result;
        },
      },
    },
  });
}
