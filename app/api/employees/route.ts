import { NextResponse } from "next/server";

import { requireApi } from "@/modules/rbac/server";
import { directoryFor } from "@/modules/team/server";

/** The team directory — humans and AI agents, in the caller's scope. */
export async function GET() {
  const access = await requireApi("read", "employee");
  if (access.response) return access.response;

  return NextResponse.json({ members: await directoryFor(access.principal) });
}
