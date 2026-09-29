import { cache } from "react";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import { DEFAULT_LANDING, LOGIN_ROUTE, SESSION_ENDED_ROUTE } from "@/lib/routes";
import { prisma } from "@/lib/prisma";
import { normalizeRole } from "@/config/permissions";
import { hasAdminPower } from "@/lib/constants";

/**
 * The session's claim alone — no database read. For the data layer's own
 * actor lookup (modules/tenancy/context), which must not go back through the
 * data layer: getCurrentUser's account read would ask it who is acting, and
 * wait on itself.
 */
export async function sessionClaim() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ? session.user : null;
}

/**
 * The signed-in user, or null. Safe to call anywhere on the server.
 *
 * The session token is only a claim of identity: the account is re-read on
 * every request (once — `cache`), so a role change, a deactivation or a
 * password change takes effect at once rather than when the token expires.
 * The role returned is the account's current one, never the token's.
 */
export const getCurrentUser = cache(async () => {
  const claim = await sessionClaim();
  if (!claim) return null;
  const session = { user: claim };
  const account = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, role: true, isActive: true, jobTitle: true, avatarColor: true, passwordChangedAt: true },
  });
  const role = normalizeRole(account?.role);
  if (!account || !account.isActive || !role) return null;
  // Issued before the password last changed: another device's session, ended.
  if ((account.passwordChangedAt?.getTime() ?? 0) !== (session.user.pwv ?? 0)) return null;
  return { ...session.user, name: account.name, email: account.email, role, jobTitle: account.jobTitle, avatarColor: account.avatarColor };
});

/**
 * Server-component guard. Middleware already blocks unauthenticated traffic;
 * this is the second line of defence so a page can never render with a null
 * user just because a matcher was mis-typed.
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  // The token outlives its account: a deleted, deactivated or unrecognised
  // account is signed out rather than shown a half-empty page.
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { isActive: true, role: true } });
  if (!account?.isActive || !normalizeRole(account.role)) redirect(SESSION_ENDED_ROUTE);
  return user;
}

/** Same, plus an ADMIN role check. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!hasAdminPower(user.role)) redirect(DEFAULT_LANDING);
  return user;
}
