import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

import { normalizeRole } from "@/config/permissions";
import { CLIENT_LANDING, DEFAULT_LANDING, LOGIN_ROUTE, canOpenRoute } from "@/lib/routes";

/**
 * The first wall (every page and handler re-checks on the server):
 *   1. No token -> NextAuth redirects to /login (the `authorized` callback).
 *   2. A token whose role is not recognised -> signed out. Never let in.
 *   3. CLIENT -> kept inside the client portal; staff -> kept out of it.
 *   4. Staff -> bounced off screens their role may not open.
 *
 * API routes are not redirected here — a redirect is meaningless to fetch();
 * every handler refuses for itself via requireApi().
 */
export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const role = normalizeRole(req.nextauth.token?.role);
    const redirect = (to: string, search = "") => {
      const url = req.nextUrl.clone();
      url.pathname = to;
      url.search = search;
      return NextResponse.redirect(url);
    };

    if (pathname.startsWith("/api/")) {
      return role ? NextResponse.next() : NextResponse.json({ error: "You must be signed in" }, { status: 401 });
    }

    if (!role || role === "AI_AGENT") return redirect("/api/auth/signout");

    const inPortal = pathname === CLIENT_LANDING || pathname.startsWith(`${CLIENT_LANDING}/`);
    if (role === "CLIENT") {
      return inPortal || pathname === "/change-password" ? NextResponse.next() : redirect(CLIENT_LANDING);
    }
    if (inPortal) return redirect(DEFAULT_LANDING);

    if (!canOpenRoute(pathname, role)) return redirect(DEFAULT_LANDING, "?denied=admin");

    return NextResponse.next();
  },
  {
    // The middleware can't import authOptions (it pulls in Prisma and bcrypt,
    // neither of which run on the edge), so the sign-in page is declared again
    // here. Without it, anonymous traffic lands on NextAuth's default
    // /api/auth/signin page instead of ours.
    pages: {
      signIn: LOGIN_ROUTE,
    },
    callbacks: {
      authorized: ({ token }) => Boolean(token),
    },
  },
);

/**
 * Everything except the login page, the auth endpoints and static assets.
 * Listing protected prefixes explicitly (rather than a negative lookahead over
 * the whole app) keeps public routes public by default.
 */
export const config = {
  matcher: [
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
    // /api/cron/* is deliberately absent: the scheduler authenticates with a
    // bearer secret rather than a session, and the handler checks it itself.
  ],
};
