import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

import { normalizeRole } from "@/config/permissions";
import { CLIENT_LANDING, DEFAULT_LANDING, LOGIN_ROUTE, SESSION_ENDED_ROUTE, canOpenRoute } from "@/lib/routes";
import { OWN_HEADERS, baseSecurityHeaders, newNonce, pageSecurityHeaders } from "@/lib/security-headers";

/**
 * Two jobs, on every request that isn't a static asset:
 *
 * **Security headers (Phase 10).** Every response gets nosniff, a referrer
 * policy, a permissions policy and (in production) HSTS. Pages also get a
 * nonce-based Content-Security-Policy and are never framed. The nonce is
 * passed on the request so Next stamps its own scripts with it.
 *
 * **The first wall** (every page and handler re-checks on the server), on
 * the protected paths below:
 *   1. No token -> sent to /login (with a same-origin callback).
 *   2. A token whose role is not recognised -> signed out. Never let in.
 *   3. CLIENT -> kept inside the client portal; staff -> kept out of it.
 *   4. Staff -> bounced off screens their role may not open.
 *
 * API routes are not redirected once signed in — a redirect is meaningless
 * to fetch(); every handler refuses for itself via requireApi().
 */

/**
 * Protected paths. Listed explicitly (rather than protecting everything and
 * carving out exceptions) so public routes stay public by default.
 * `/x/:path*` covers `/x` and everything under it.
 */
const PROTECTED = [
  "/",
  // Authenticated, but deliberately outside the app shell — the forced
  // password change must be reachable while it is still forced.
  "/change-password",
  "/dashboard/:path*",
  "/clients/:path*",
  "/projects/:path*",
  "/my-tasks/:path*",
  "/pipeline/:path*",
  "/disputes/:path*",
  "/incentives/:path*",
  "/scoring/:path*",
  "/admin/:path*",
  "/my-performance/:path*",
  "/my-reports/:path*",
  "/board/:path*",
  "/my-attendance/:path*",
  "/attendance/:path*",
  "/settings/:path*",
  "/team/:path*",
  "/reports/:path*",
  "/tasks/:path*",
  "/outreach/:path*",
  "/messages/:path*",
  "/invoices/:path*",
  "/notifications/:path*",
  "/analytics/:path*",
  "/agents/:path*",
  "/approvals/:path*",
  "/automations/:path*",
  "/api/agents/:path*",
  "/api/approvals/:path*",
  "/api/automations/:path*",
  "/api/me/:path*",
  "/api/announcements/:path*",
  "/api/command/:path*",
  "/api/analytics/:path*",
  "/finance/:path*",
  "/api/invoices/:path*",
  "/api/finance/:path*",
  "/portal/:path*",
  "/api/reports/:path*",
  "/api/notifications/:path*",
  "/api/board/:path*",
  "/api/attachments/:path*",
  "/api/activity/:path*",
  "/api/search/:path*",
  "/api/attendance/:path*",
  "/api/leave/:path*",
  "/api/settings/:path*",
  "/api/team/:path*",
  "/api/clients/:path*",
  "/api/leads/:path*",
  "/api/targets/:path*",
  "/api/capacity/:path*",
  "/api/disputes/:path*",
  "/api/incentives/:path*",
  "/api/service-leads/:path*",
  "/api/audit/:path*",
  "/api/services/:path*",
  "/api/projects/:path*",
  "/api/modules/:path*",
  "/api/milestones/:path*",
  "/api/score-events/:path*",
  "/api/my-tasks/:path*",
  "/api/files/:path*",
  "/api/credentials/:path*",
  "/api/portal/:path*",
  "/api/messages/:path*",
  // /api/cron/* is deliberately absent: the scheduler authenticates with a
  // bearer secret rather than a session, and the handler checks it itself.
];

const isProtected = (pathname: string) =>
  PROTECTED.some((p) => {
    if (!p.endsWith("/:path*")) return pathname === p;
    const base = p.slice(0, -"/:path*".length);
    return pathname === base || pathname.startsWith(`${base}/`);
  });

const DEV = process.env.NODE_ENV !== "production";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const nonce = newNonce();
  const isApi = pathname.startsWith("/api/");
  const ownHeaders = OWN_HEADERS.some((re) => re.test(pathname));
  // Vercel (and any proxy) reports the original scheme; direct requests carry it in the URL.
  const https = (req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "")) === "https";
  const options = { dev: DEV, https };
  const headers = isApi || ownHeaders ? baseSecurityHeaders(options) : pageSecurityHeaders(nonce, options);

  const finish = (res: NextResponse) => {
    for (const [k, v] of Object.entries(headers)) if (!ownHeaders || !res.headers.has(k)) res.headers.set(k, v);
    return res;
  };
  const pass = () => {
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-nonce", nonce);
    if (headers["Content-Security-Policy"]) requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);
    return finish(NextResponse.next({ request: { headers: requestHeaders } }));
  };
  const redirect = (to: string, search = "") => {
    const url = req.nextUrl.clone();
    url.pathname = to;
    url.search = search;
    return finish(NextResponse.redirect(url));
  };

  if (!isProtected(pathname)) return pass();

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token) {
    // As NextAuth's withAuth did: to our sign-in page, remembering where to return.
    return redirect(LOGIN_ROUTE, `?${new URLSearchParams({ callbackUrl: `${pathname}${req.nextUrl.search}` })}`);
  }

  const role = normalizeRole(token.role);
  if (isApi) {
    return role ? pass() : finish(NextResponse.json({ error: "You must be signed in" }, { status: 401 }));
  }

  if (!role || role === "AI_AGENT") return redirect(SESSION_ENDED_ROUTE);

  const inPortal = pathname === CLIENT_LANDING || pathname.startsWith(`${CLIENT_LANDING}/`);
  if (role === "CLIENT") {
    return inPortal || pathname === "/change-password" ? pass() : redirect(CLIENT_LANDING);
  }
  if (inPortal) return redirect(DEFAULT_LANDING);

  if (!canOpenRoute(pathname, role)) return redirect(DEFAULT_LANDING, "?denied=admin");

  return pass();
}

/** Everything but static files — the headers belong on every page and API response. */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|robots.txt).*)"],
};
