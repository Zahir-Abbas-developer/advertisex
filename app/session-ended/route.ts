import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { LOGIN_ROUTE } from "@/lib/routes";

/**
 * Where a session goes when its token is valid but the account behind it is
 * not: deleted, deactivated, or given a role nobody recognises. The cookie is
 * cleared here, then the person is sent to sign in.
 *
 * Sending them straight to /login instead loops: the login page sees a
 * signed-in token and forwards it on, and the page it reaches can't find the
 * account and sends it back.
 */
export function GET(request: Request) {
  const response = NextResponse.redirect(new URL(`${LOGIN_ROUTE}?ended=1`, request.url));
  for (const { name } of cookies().getAll()) {
    // NextAuth splits a large token into `.0`, `.1`… chunks; clear them all.
    if (/^(__Secure-)?next-auth\.session-token/.test(name)) {
      response.cookies.set(name, "", { path: "/", maxAge: 0 });
    }
  }
  return response;
}
