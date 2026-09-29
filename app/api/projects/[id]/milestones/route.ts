import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { formatDate, parseDateInput } from "@/lib/date";
import { notify } from "@/lib/notifications";
import { requireApi } from "@/modules/rbac/server";
import { canShapeProject, projectFor } from "@/modules/projects/server";
import { milestoneFields } from "@/modules/projects/schemas";


/** Adds a milestone. Its assignee joins the project team if not already on it. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers change the plan", 403);

  const parsed = z.object(milestoneFields).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const d = parsed.data;

  const dueDate = d.dueDate ? parseDateInput(d.dueDate) : null;
  if (d.dueDate && !dueDate) return apiError("Please fix the highlighted fields", 422, { dueDate: "Not a date" });
  if (d.stageId && !(await prisma.projectStage.findFirst({ where: { id: d.stageId, projectId: params.id }, select: { id: true } }))) {
    return apiError("Please fix the highlighted fields", 422, { stageId: "That stage isn't on this project" });
  }
  if (d.assigneeId) {
    const who = await prisma.user.findUnique({ where: { id: d.assigneeId }, select: { isActive: true, role: true } });
    if (!who?.isActive || who.role === "CLIENT") return apiError("Please fix the highlighted fields", 422, { assigneeId: "Pick an active team member" });
  }

  const last = await prisma.projectMilestone.findFirst({ where: { projectId: params.id }, orderBy: { order: "desc" }, select: { order: true } });
  const milestone = await prisma.projectMilestone.create({
    data: {
      projectId: params.id,
      title: d.title,
      description: d.description ?? null,
      stageId: d.stageId ?? null,
      dueDate,
      weight: d.weight,
      assigneeId: d.assigneeId ?? null,
      order: (last?.order ?? -1) + 1,
    },
  });
  if (d.assigneeId) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: params.id, userId: d.assigneeId } },
      create: { projectId: params.id, userId: d.assigneeId },
      update: {},
    });
    if (d.assigneeId !== gate.principal.id) {
      await notify({
        userId: d.assigneeId,
        type: "TASK_ASSIGNED",
        title: "A project milestone is yours",
        body: `${d.title} · ${found.project.title}${dueDate ? ` — due ${formatDate(dueDate)}` : ""}.`,
        href: `/projects/${params.id}`,
      });
    }
  }
  return NextResponse.json({ milestone }, { status: 201 });
}
