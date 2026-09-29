import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { STAGE_STATUSES, stageMove } from "@/modules/projects/domain";
import { canShapeProject, notifyTeam, projectFor } from "@/modules/projects/server";

const schema = z
  .object({
    status: z.enum(STAGE_STATUSES).optional(),
    name: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

/**
 * Moves a stage (anyone working on the project) or renames it (founder and
 * managers). Completing a stage starts the next one of its line.
 */
export async function PATCH(
  request: Request,
  props: { params: Promise<{ id: string; stageId: string }> }
) {
  const params = await props.params;
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422);
  if (parsed.data.name !== undefined && !canShapeProject(gate.principal, found.project)) {
    return apiError("Only the founder and managers rename stages", 403);
  }

  const stages = await prisma.projectStage.findMany({ where: { projectId: params.id } });
  const stage = stages.find((s) => s.id === params.stageId);
  if (!stage) return apiError("That stage doesn't exist", 404);

  const now = new Date();
  const changes = parsed.data.status ? stageMove(stages, stage.id, parsed.data.status) : [];
  await prisma.$transaction([
    ...(parsed.data.name !== undefined ? [prisma.projectStage.update({ where: { id: stage.id }, data: { name: parsed.data.name } })] : []),
    ...changes.map((c) => {
      const row = stages.find((s) => s.id === c.id)!;
      return prisma.projectStage.update({
        where: { id: c.id },
        data: {
          status: c.status,
          startedAt: c.status === "ACTIVE" ? row.startedAt ?? now : c.status === "PENDING" ? null : row.startedAt ?? now,
          completedAt: c.status === "DONE" ? now : null,
        },
      });
    }),
  ]);

  if (parsed.data.status === "DONE" && stage.status !== "DONE") {
    const next = changes.find((c) => c.id !== stage.id && c.status === "ACTIVE");
    const nextName = next ? stages.find((s) => s.id === next.id)?.name : null;
    await notifyTeam(params.id, gate.principal.id, {
      type: "PROJECT_UPDATED",
      title: `${found.project.title}: ${stage.name} complete`,
      body: nextName ? `Next up: ${nextName}.` : "That was the last stage of its line.",
    });
  }
  return NextResponse.json({ ok: true, changed: changes.length });
}

export async function DELETE(
  _request: Request,
  props: { params: Promise<{ id: string; stageId: string }> }
) {
  const params = await props.params;
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers change the plan", 403);

  const existing = await prisma.projectStage.findFirst({ where: { id: params.stageId, projectId: params.id }, select: { id: true } });
  if (!existing) return apiError("That stage doesn't exist", 404);
  // A single-row delete, so the audit entry keeps what was removed.
  await prisma.projectStage.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
