import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canShapeProject, projectFor } from "@/modules/projects/server";
import { AssignmentError, decideReassignment } from "@/modules/assignment/server";

const schema = z.object({ accept: z.boolean() }).strict();

/** Accept (the role moves) or dismiss a "reassignment suggested" signal. */
export async function PATCH(request: Request, props: { params: Promise<{ id: string; sid: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers decide assignments", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Say whether to accept", 422);
  try {
    const s = await decideReassignment(gate.principal.id, params.sid, params.id, parsed.data.accept);
    return NextResponse.json({ suggestion: { id: s.id, status: s.status } });
  } catch (error) {
    if (error instanceof AssignmentError) return apiError(error.message, error.status);
    throw error;
  }
}
