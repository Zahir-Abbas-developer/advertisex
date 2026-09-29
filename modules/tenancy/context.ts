import { AsyncLocalStorage } from "node:async_hooks";

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

/**
 * An explicit actor for work done outside a request — an AI agent's run
 * (Phase 9). Inside `actingAs(actor, fn)`, queries are scoped to the actor's
 * organization and audit entries are attributed to them, exactly as if they
 * had made the request themselves.
 */
// One instance per process, on globalThis like the Prisma client and the
// audit buffer: Next loads this module once per bundle, and the client built
// in one bundle must see the actor set by code in another (an agent run
// started from a route handler).
const globalForActor = globalThis as unknown as { explicitActor?: AsyncLocalStorage<RequestActor>; systemScope?: AsyncLocalStorage<true> };
const explicitActor = (globalForActor.explicitActor ??= new AsyncLocalStorage<RequestActor>());

export function actingAs<T>(actor: RequestActor, fn: () => Promise<T>): Promise<T> {
  return explicitActor.run(actor, fn);
}

/**
 * Work the system does on its own behalf, even when a request started it —
 * the agent worker, kicked off by a request but outliving it, must not
 * inherit (or later re-read) that person's session.
 */
const systemScope = (globalForActor.systemScope ??= new AsyncLocalStorage<true>());

export function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  return systemScope.run(true, () => explicitActor.exit(fn));
}

export async function requestActor(base: PrismaClient): Promise<RequestActor | null> {
  const explicit = explicitActor.getStore();
  if (explicit) return explicit;
  if (systemScope.getStore()) return null;
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
