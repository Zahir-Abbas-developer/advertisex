import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canShapeProject, projectFor } from "@/modules/projects/server";
import { AssignmentError, decide } from "@/modules/assignment/server";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ACCEPT") }),
  z.object({ action: z.literal("OVERRIDE"), userId: z.string().min(1), reason: z.string().trim().max(500).nullish() }),
  z.object({ action: z.literal("DISMISS") }),
]);

/**
 * A decision on one role. An override is audit-logged (the data layer
 * records the row's before and after) and becomes a signal in later scoring.
 */
export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string; recId: string }> }
) {
  const params = await props.params;
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers decide assignments", 403);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, { userId: "Choose someone" });
  const d = parsed.data;
  try {
    const rec = await decide(
      gate.principal.id,
      params.recId,
      params.id,
      d.action === "OVERRIDE" ? { kind: "OVERRIDE", userId: d.userId, reason: d.reason } : { kind: d.action },
    );
    return NextResponse.json({ recommendation: { id: rec.id, status: rec.status, chosenUserId: rec.chosenUserId } });
  } catch (error) {
    if (error instanceof AssignmentError) return apiError(error.message, error.status);
    throw error;
  }
}
