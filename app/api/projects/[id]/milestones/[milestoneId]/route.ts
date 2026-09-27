import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { parseDateInput } from "@/lib/date";
import { notify } from "@/lib/notifications";
import { requireApi } from "@/modules/rbac/server";
import { milestoneFields } from "@/modules/projects/schemas";
import { canShapeProject, notifyTeam, projectFor } from "@/modules/projects/server";

const schema = z
  .object({
    status: z.enum(["OPEN", "DONE"]).optional(),
    title: milestoneFields.title.optional(),
    description: milestoneFields.description,
    stageId: milestoneFields.stageId,
    dueDate: milestoneFields.dueDate,
    weight: z.number().int().min(1).max(5).optional(),
    assigneeId: milestoneFields.assigneeId,
  })
  .strict();

/**
 * Ticks a milestone done or reopens it (anyone working on the project), or
 * edits it (founder and managers).
 */
export async function PATCH(request: Request, { params }: { params: { id: string; milestoneId: string } }) {
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const { status, ...edits } = parsed.data;
  const editing = Object.values(edits).some((v) => v !== undefined);
  if (editing && !canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers edit milestones", 403);

  const existing = await prisma.projectMilestone.findFirst({ where: { id: params.milestoneId, projectId: params.id } });
  if (!existing) return apiError("That milestone doesn't exist", 404);

  const dueDate = edits.dueDate === undefined ? undefined : edits.dueDate ? parseDateInput(edits.dueDate) : null;
  if (edits.dueDate && !dueDate) return apiError("Please fix the highlighted fields", 422, { dueDate: "Not a date" });
  if (edits.stageId && !(await prisma.projectStage.findFirst({ where: { id: edits.stageId, projectId: params.id }, select: { id: true } }))) {
    return apiError("Please fix the highlighted fields", 422, { stageId: "That stage isn't on this project" });
  }

  if (edits.assigneeId) {
    const who = await prisma.user.findUnique({ where: { id: edits.assigneeId }, select: { isActive: true, role: true } });
    if (!who?.isActive || who.role === "CLIENT") return apiError("Please fix the highlighted fields", 422, { assigneeId: "Pick an active team member" });
  }

  const milestone = await prisma.projectMilestone.update({
    where: { id: existing.id },
    data: {
      ...(status && status !== existing.status ? { status, completedAt: status === "DONE" ? new Date() : null } : {}),
      ...(edits.title !== undefined ? { title: edits.title } : {}),
      ...(edits.description !== undefined ? { description: edits.description } : {}),
      ...(edits.stageId !== undefined ? { stageId: edits.stageId } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(edits.weight !== undefined ? { weight: edits.weight } : {}),
      ...(edits.assigneeId !== undefined ? { assigneeId: edits.assigneeId } : {}),
    },
  });
  if (edits.assigneeId && edits.assigneeId !== existing.assigneeId) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: params.id, userId: edits.assigneeId } },
      create: { projectId: params.id, userId: edits.assigneeId },
      update: {},
    });
    if (edits.assigneeId !== gate.principal.id) {
      await notify({
        userId: edits.assigneeId,
        type: "TASK_ASSIGNED",
        title: "A project milestone is yours",
        body: `${milestone.title} · ${found.project.title}.`,
        href: `/projects/${params.id}`,
      });
    }
  }
  if (status === "DONE" && existing.status !== "DONE") {
    await notifyTeam(params.id, gate.principal.id, {
      type: "PROJECT_UPDATED",
      title: `${found.project.title}: milestone reached`,
      body: existing.title,
    });
  }
  return NextResponse.json({ milestone });
}

export async function DELETE(_request: Request, { params }: { params: { id: string; milestoneId: string } }) {
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers change the plan", 403);
  const existing = await prisma.projectMilestone.findFirst({ where: { id: params.milestoneId, projectId: params.id }, select: { id: true } });
  if (!existing) return apiError("That milestone doesn't exist", 404);
  // A single-row delete, so the audit entry keeps what was removed.
  await prisma.projectMilestone.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
