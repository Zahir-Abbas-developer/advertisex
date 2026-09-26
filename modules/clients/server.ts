import { prisma } from "@/lib/prisma";
import { authorize, type Principal } from "@/modules/rbac/authorize";
import type { Action } from "@/config/permissions";

/**
 * Loading a client for an action (Phase 4). Outside scope reads as "not
 * found"; inside scope but not allowed this action is 403.
 */
export async function clientFor(principal: Principal, id: string, action: Action) {
  const client = await prisma.client.findUnique({
    where: { id },
    select: { id: true, organizationId: true, departmentId: true, businessName: true, clientAccountId: true },
  });
  if (!client) return { client: null, status: 404 as const };
  const target = { organizationId: client.organizationId, departmentId: client.departmentId, clientId: client.id };
  if (!authorize(principal, "read", "client", target).allowed || principal.role === "CLIENT") return { client: null, status: 404 as const };
  if (!authorize(principal, action, "client", target).allowed) return { client: null, status: 403 as const };
  return { client, status: 200 as const };
}

/** Money — prices, contract values, billing — is the founder's alone. */
export const seesMoney = (principal: Principal) => principal.role === "FOUNDER";
