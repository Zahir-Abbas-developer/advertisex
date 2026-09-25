import { NextResponse } from "next/server";

import { requireApi } from "@/modules/rbac/server";
import { getCurrentUser } from "@/lib/session";

/** Shape every API error shares, so clients can render one code path. */
export type ApiError = {
  error: string;
  fields?: Record<string, string>;
};

export function apiError(
  message: string,
  status: number,
  fields?: Record<string, string>,
) {
  return NextResponse.json<ApiError>({ error: message, fields }, { status });
}

/**
 * Route-handler guard. Middleware blocks anonymous traffic to /api/team, but
 * the role check belongs here too — an API is not protected by the fact that
 * its UI is hidden.
 */
export async function requireAdminApi() {
  const gate = await requireApi("manage", "admin", "Only the founder can do that");
  if (gate.response) return { user: null, response: gate.response };

  const user = await getCurrentUser();
  if (!user) return { user: null, response: apiError("You must be signed in", 401) };
  return { user, response: null };
}
