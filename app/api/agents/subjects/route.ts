import { NextResponse } from "next/server";

import { requireApi } from "@/modules/rbac/server";
import { searchSubjects } from "@/modules/ai/agents/server";

/** Search the records the caller may give an agent work on: `?type=lead|client|project&q=`. */
export async function GET(request: Request) {
  const gate = await requireApi("create", "agent", "You can't give AI employees work");
  if (gate.response) return gate.response;
  const p = new URL(request.url).searchParams;
  const type = p.get("type");
  if (type !== "lead" && type !== "client" && type !== "project") return NextResponse.json({ results: [] });
  return NextResponse.json({ results: await searchSubjects(gate.principal, type, p.get("q") ?? "") });
}

export const dynamic = "force-dynamic";
