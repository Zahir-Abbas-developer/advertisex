import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { portalProject } from "@/modules/portal/server";

/** One of the client's own projects, as the portal shows it. Anyone else's: 404. */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  if (gate.principal.role !== "CLIENT") return apiError("Not found", 404);
  const project = await portalProject(gate.principal, params.id);
  if (!project) return apiError("Not found", 404);
  return NextResponse.json({ project });
}
