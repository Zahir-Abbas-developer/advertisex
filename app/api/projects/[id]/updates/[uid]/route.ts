import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { canShapeProject, projectFor } from "@/modules/projects/server";
import { notifyUpdateShared } from "@/modules/portal/server";

const schema = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    body: z.string().trim().min(1).max(4000).optional(),
    visibility: z.enum(["INTERNAL", "CLIENT"]).optional(),
  })
  .strict();

/** Edits an update, or changes who can see it (founder and managers; its author may edit the text). */
export async function PATCH(request: Request, props: { params: Promise<{ id: string; uid: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  const existing = await prisma.projectUpdate.findFirst({ where: { id: params.uid, projectId: params.id } });
  if (!existing) return apiError("That update doesn't exist", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422);
  const shaper = canShapeProject(gate.principal, found.project);
  if (parsed.data.visibility !== undefined && !shaper) return apiError("Only the founder and managers change who sees an update", 403);
  if (!shaper && existing.authorId !== gate.principal.id) return apiError("Only its author or a manager edits an update", 403);

  const updated = await prisma.projectUpdate.update({ where: { id: existing.id }, data: parsed.data, select: { id: true, visibility: true, title: true } });
  if (existing.visibility !== "CLIENT" && updated.visibility === "CLIENT") await notifyUpdateShared(params.id, updated.title);
  return NextResponse.json({ update: updated });
}

export async function DELETE(_request: Request, props: { params: Promise<{ id: string; uid: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  if (gate.principal.role === "CLIENT") return apiError("Not found", 404);
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  const existing = await prisma.projectUpdate.findFirst({ where: { id: params.uid, projectId: params.id }, select: { id: true, authorId: true } });
  if (!existing) return apiError("That update doesn't exist", 404);
  if (!canShapeProject(gate.principal, found.project) && existing.authorId !== gate.principal.id) return apiError("Only its author or a manager removes an update", 403);
  await prisma.projectUpdate.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
