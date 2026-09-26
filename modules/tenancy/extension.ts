import { Prisma, type PrismaClient } from "@prisma/client";

import { requestActor } from "@/modules/tenancy/context";
import { isTenantModel, scopeArgs } from "@/modules/tenancy/scope";

/**
 * The tenancy wall in the data layer (CLAUDE.md §5; ADR-005).
 *
 * Every query on a tenant-owned model made inside a signed-in request is
 * rewritten by `scopeArgs` to the caller's organization. Handlers keep their
 * own filters — department scope, assignment, ownership — and this adds the
 * one no handler is allowed to forget. Outside a request (cron, seeds,
 * scripts) the system acts unscoped, by design.
 *
 * A signed-in caller whose account has no organization is refused outright
 * rather than run unscoped: a tenant-less principal must see nothing, not
 * everything.
 *
 * Row-Level Security in Postgres is the second wall, keyed on the same
 * organization id (ADR-005); this extension is what makes the first one
 * impossible to bypass from application code.
 */
export function withTenancy(base: PrismaClient) {
  return Prisma.defineExtension({
    name: "tenancy",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !isTenantModel(model)) return query(args);

          const actor = await requestActor(base);
          if (!actor) return query(args);
          if (!actor.organizationId) {
            throw new Error("Tenant scope unavailable: the signed-in account has no organization.");
          }

          return query(
            scopeArgs(model, operation, args as Record<string, unknown>, actor.organizationId) as typeof args,
          );
        },
      },
    },
  });
}
