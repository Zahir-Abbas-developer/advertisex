import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { threadsFor } from "@/modules/messages/server";

/** The threads this person may see (a client: their own two). `?clientId=` narrows for staff. */
export async function GET(request: Request) {
  const gate = await requireApi("read", "message");
  if (gate.response) return gate.response;
  const clientId = new URL(request.url).searchParams.get("clientId") ?? undefined;
  if (clientId && gate.principal.role === "CLIENT") return apiError("Not found", 404);
  return NextResponse.json({ threads: await threadsFor(gate.principal, { clientId }), viewer: { id: gate.principal.id, role: gate.principal.role } });
}
