import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import {
  normalizeRole,
  STAFF_ROLES,
  type Action,
  type Resource,
} from "@/config/permissions";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_LANDING, LOGIN_ROUTE } from "@/lib/routes";
import { authorize, grantKey, type Principal } from "@/modules/rbac/authorize";

/**
 * The server half of authorization: turning a signed-in session into a
 * `Principal`, and refusing requests before they touch data.
 *
 * The principal is read from the database on every request, never from the
 * session cookie — a cookie is something the browser holds, and demoting,
 * deactivating or re-scoping someone has to take effect on their next
 * request, not their next sign-in. The session supplies only *who*.
 */

type SessionUser = { id: string };

/**
 * Resolve the acting principal, or null. Null means refuse: no such user,
 * deactivated, or a role `normalizeRole` does not recognise.
 */
export async function principalFor(user: SessionUser): Promise<Principal | null> {
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      role: true,
      isActive: true,
      organizationId: true,
      clientAccountId: true,
    },
  });
  if (!account || !account.isActive) return null;

  const role = normalizeRole(account.role);
  if (!role) return null;

  const [memberships, ownedClients, taskClients, milestoneClients, grants] = await Promise.all([
    prisma.departmentMembership.findMany({
      where: { userId: account.id, department: { isActive: true } },
      select: { departmentId: true },
    }),
    prisma.client.findMany({ where: { assigneeId: account.id }, select: { id: true } }),
    prisma.task.findMany({
      where: { assigneeId: account.id, clientId: { not: null } },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
    prisma.milestone.findMany({
      where: { assigneeId: account.id },
      select: { module: { select: { project: { select: { clientId: true } } } } },
      distinct: ["moduleId"],
    }),
    role === "AI_AGENT"
      ? prisma.agentGrant.findMany({
          where: { agentId: account.id },
          select: { resource: true, action: true },
        })
      : Promise.resolve([]),
  ]);

  const assignedClientIds = new Set<string>([
    ...ownedClients.map((client) => client.id),
    ...taskClients.map((task) => task.clientId).filter((id): id is string => Boolean(id)),
    ...milestoneClients.map((row) => row.module.project.clientId),
  ]);

  return {
    id: account.id,
    role,
    organizationId: account.organizationId,
    departmentIds: memberships.map((m) => m.departmentId),
    clientAccountId: role === "CLIENT" ? account.clientAccountId : null,
    assignedClientIds: [...assignedClientIds],
    grants: grants.map((g) =>
      grantKey(g.resource as Resource, g.action as Action),
    ),
  };
}

type ApiGate =
  | { principal: Principal; response: null }
  | { principal: null; response: NextResponse };

function refuse(message: string, status: number): ApiGate {
  return { principal: null, response: NextResponse.json({ error: message }, { status }) };
}

/**
 * The gate at the top of every route handler:
 *
 *   const gate = await requireApi("update", "lead");
 *   if (gate.response) return gate.response;
 *
 * Role-level only — whether this role may perform this action on this kind
 * of resource at all. Row-level scope is then enforced by the handler's
 * scoped query or by `authorize(gate.principal, action, resource, target)`
 * once the row is loaded. A CLIENT or AI_AGENT session reaching a team
 * endpoint is refused here, before any query runs.
 */
export async function requireApi(
  action: Action,
  resource: Resource,
  message?: string,
): Promise<ApiGate> {
  const user = await getCurrentUser();
  if (!user) return refuse("You must be signed in", 401);

  const principal = await principalFor(user);
  if (!principal) return refuse("Your account can't do that", 403);

  const decision = authorize(principal, action, resource);
  if (!decision.allowed) return refuse(message ?? "You don't have access to that", 403);

  return { principal, response: null };
}

/**
 * Page guard for the team product — the (app) shell. Anyone who is not staff
 * (a CLIENT, an AI_AGENT, an unrecognised role) is sent to their own shell or
 * to sign-in, server-side, before the page renders.
 */
export async function requireStaffPage(): Promise<Principal> {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);

  const principal = await principalFor(user);
  if (!principal) redirect(LOGIN_ROUTE);
  if (principal.role === "CLIENT") redirect("/portal");
  if (!STAFF_ROLES.includes(principal.role)) redirect(LOGIN_ROUTE);

  return principal;
}

/**
 * Page guard for one team screen: staff only, and the role must hold the
 * action on the resource. A refusal lands on the dashboard, the same way the
 * middleware bounces a restricted route.
 */
export async function requirePage(action: Action, resource: Resource): Promise<Principal> {
  const principal = await requireStaffPage();
  if (!authorize(principal, action, resource).allowed) redirect(`${DEFAULT_LANDING}?denied=admin`);
  return principal;
}

/** Page guard for the client portal — the (client) shell. */
export async function requireClientPage(): Promise<Principal> {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);

  const principal = await principalFor(user);
  if (!principal) redirect(LOGIN_ROUTE);
  if (principal.role !== "CLIENT") redirect("/dashboard");

  return principal;
}
