import type { PrismaClient } from "@prisma/client";

import { normalizeRole } from "@/config/permissions";

/**
 * Who is acting in the current request, for the data layer: the tenancy
 * extension scopes queries by their organization, the audit extension records
 * them as the actor.
 *
 * Resolved from the session cookie, then the account row (via the *base*
 * client, so resolving the context never re-enters the extensions). Outside a
 * request — cron jobs, seeds, scripts — there is no session and the result is
 * null: the caller is the system itself, queries run unscoped and audit
 * entries are typed SYSTEM.
 *
 * Cached once per request, keyed on the request's cookie store: a page runs
 * dozens of queries and must not decode the session for each.
 */

export type RequestActor = {
  userId: string;
  role: string | null;
  organizationId: string | null;
};

const cache = new WeakMap<object, Promise<RequestActor | null>>();

async function resolve(base: PrismaClient): Promise<RequestActor | null> {
  // Imported lazily: lib/session → lib/auth → lib/prisma would otherwise form
  // a cycle with the client this module helps build.
  const { getCurrentUser } = await import("@/lib/session");
  const user = await getCurrentUser();
  if (!user?.id) return null;

  const account = await base.user.findUnique({
    where: { id: user.id },
    select: { id: true, role: true, organizationId: true },
  });
  if (!account) return null;

  return {
    userId: account.id,
    role: normalizeRole(account.role),
    organizationId: account.organizationId,
  };
}

export async function requestActor(base: PrismaClient): Promise<RequestActor | null> {
  let store: object;
  try {
    const { cookies } = await import("next/headers");
    store = cookies();
  } catch {
    return null; // not inside a request
  }

  const cached = cache.get(store);
  if (cached) return cached;

  const pending = resolve(base).catch(() => null);
  cache.set(store, pending);
  return pending;
}
