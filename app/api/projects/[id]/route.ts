import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { formatDate, parseDateInput } from "@/lib/date";
import { remove } from "@/lib/uploads";
import { normalizeTaskStatus } from "@/modules/tasks/domain";
import { authorize } from "@/modules/rbac/authorize";
import { requireApi } from "@/modules/rbac/server";
import { canOnCredentials } from "@/modules/vault/credentials";
import {
  currentStages,
  normalizeProjectStatus,
  PROJECT_PRIORITIES,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUSES,
  upcomingWork,
} from "@/modules/projects/domain";
import { canShapeProject, notifyTeam, projectFor, summarize } from "@/modules/projects/server";

/**
 * One project: its overview, plan (stages, milestones), tasks, team and
 * skills. Files, comments and activity load from their own endpoints.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  const principal = gate.principal;
  const found = await projectFor(principal, params.id, "read");
  if (!found.project) return apiError("That project doesn't exist", 404);

  const p = await prisma.project.findUniqueOrThrow({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      priority: true,
      startDate: true,
      endDate: true,
      completedAt: true,
      createdAt: true,
      organizationId: true,
      client: { select: { id: true, businessName: true, departmentId: true, organizationId: true } },
      owner: { select: { id: true, name: true, avatarColor: true } },
      services: { select: { service: { select: { id: true, name: true } } } },
      members: { select: { role: true, user: { select: { id: true, name: true, avatarColor: true, jobTitle: true, role: true } } } },
      skills: { select: { source: true, skill: { select: { id: true, name: true, category: true } } } },
      stages: { orderBy: [{ serviceId: "asc" }, { order: "asc" }] },
      milestones: {
        orderBy: [{ dueDate: "asc" }, { order: "asc" }],
        include: { assignee: { select: { id: true, name: true, avatarColor: true } } },
      },
    },
  });
  const tasks = await prisma.task.findMany({
    where: { projectId: p.id },
    orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    select: { id: true, title: true, status: true, priority: true, dueAt: true, assignee: { select: { id: true, name: true, avatarColor: true } } },
  });
  const summary = (await summarize([p])).get(p.id)!;
  const now = new Date();

  const serviceName = new Map(p.services.map((s) => [s.service.id, s.service.name]));
  const current = currentStages(p.stages).map((s) => ({ id: s.id, name: s.name, service: s.serviceId ? serviceName.get(s.serviceId) ?? null : null }));
  const upcoming = upcomingWork(
    [
      ...p.milestones.map((m) => ({ id: m.id, kind: "MILESTONE" as const, title: m.title, dueAt: m.dueDate, done: m.status === "DONE" })),
      ...tasks.map((t) => ({ id: t.id, kind: "TASK" as const, title: t.title, dueAt: t.dueAt, done: normalizeTaskStatus(t.status) === "COMPLETED" })),
    ],
    now,
  ).map((w) => ({ ...w, dueAt: w.dueAt?.toISOString() ?? null }));

  const clientRef = { id: p.client.id, organizationId: p.client.organizationId, departmentId: p.client.departmentId, businessName: p.client.businessName };
  return NextResponse.json({
    project: {
      id: p.id,
      title: p.title,
      description: p.description,
      status: normalizeProjectStatus(p.status),
      priority: p.priority,
      startDate: p.startDate.toISOString().slice(0, 10),
      deadline: p.endDate.toISOString().slice(0, 10),
      completedAt: p.completedAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      client: { id: p.client.id, businessName: p.client.businessName },
      owner: p.owner,
      services: p.services.map((s) => s.service),
      team: p.members.map((m) => ({ ...m.user, projectRole: m.role })),
      skills: p.skills.map((s) => ({ ...s.skill, source: s.source })),
      stages: p.stages.map((s) => ({
        id: s.id,
        name: s.name,
        order: s.order,
        status: s.status,
        serviceId: s.serviceId,
        service: s.serviceId ? serviceName.get(s.serviceId) ?? null : null,
        startedAt: s.startedAt?.toISOString() ?? null,
        completedAt: s.completedAt?.toISOString() ?? null,
      })),
      currentStages: current,
      milestones: p.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        stageId: m.stageId,
        dueDate: m.dueDate?.toISOString().slice(0, 10) ?? null,
        status: m.status,
        weight: m.weight,
        completedAt: m.completedAt?.toISOString() ?? null,
        assignee: m.assignee,
      })),
      tasks: tasks.map((t) => ({ ...t, status: normalizeTaskStatus(t.status), dueAt: t.dueAt?.toISOString() ?? null })),
      upcoming,
      summary: {
        progress: summary.progress,
        schedule: summary.schedule,
        daysOverdue: summary.daysOverdue,
        openMilestones: summary.openMilestones,
        openTasks: summary.openTasks,
      },
    },
    viewer: {
      canShape: canShapeProject(principal, found.project),
      canWork: authorize(principal, "update", "project", { organizationId: p.organizationId, departmentId: p.client.departmentId, projectId: p.id }).allowed,
      canDelete: authorize(principal, "delete", "project", { organizationId: p.organizationId }).allowed,
      canSeeCredentials: canOnCredentials(principal, "read", clientRef),
      canSeeClient: authorize(principal, "read", "client", { organizationId: p.client.organizationId, departmentId: p.client.departmentId, clientId: p.client.id }).allowed && principal.role !== "EMPLOYEE",
    },
  });
}

const patchSchema = z
  .object({
    title: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
    priority: z.enum(PROJECT_PRIORITIES).optional(),
    startDate: z.string().optional(),
    deadline: z.string().optional(),
    ownerId: z.string().min(1).nullable().optional(),
  })
  .strict();

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  if (!canShapeProject(gate.principal, found.project)) return apiError("Only the founder and managers change a project's details", 403);

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const d = parsed.data;

  const existing = await prisma.project.findUniqueOrThrow({ where: { id: params.id }, select: { startDate: true, endDate: true, status: true, title: true, ownerId: true } });
  const start = d.startDate ? parseDateInput(d.startDate) : existing.startDate;
  const end = d.deadline ? parseDateInput(d.deadline) : existing.endDate;
  if (!start || !end) return apiError("Please fix the highlighted fields", 422, !start ? { startDate: "Not a date" } : { deadline: "Not a date" });
  if (end <= start) return apiError("Please fix the highlighted fields", 422, { deadline: "The deadline must be after the start" });

  if (d.ownerId) {
    const owner = await prisma.user.findUnique({ where: { id: d.ownerId }, select: { isActive: true, role: true } });
    if (!owner?.isActive || owner.role === "CLIENT") return apiError("Please fix the highlighted fields", 422, { ownerId: "Pick an active team member" });
  }

  const wasStatus = normalizeProjectStatus(existing.status);
  const updated = await prisma.project.update({
    where: { id: params.id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.priority ? { priority: d.priority } : {}),
      // Completing stamps the date once; reopening clears it.
      ...(d.status && d.status !== wasStatus ? { status: d.status, completedAt: d.status === "COMPLETED" ? new Date() : null } : {}),
      ...(d.startDate ? { startDate: start } : {}),
      ...(d.deadline ? { endDate: end, delayedAt: null } : {}),
      ...(d.ownerId !== undefined ? { ownerId: d.ownerId } : {}),
    },
    select: { id: true, title: true, status: true, endDate: true, ownerId: true },
  });
  if (d.ownerId) {
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: updated.id, userId: d.ownerId } },
      create: { projectId: updated.id, userId: d.ownerId, role: "LEAD" },
      update: { role: "LEAD" },
    });
  }

  const changes: string[] = [];
  if (d.status && d.status !== wasStatus) changes.push(`is now ${PROJECT_STATUS_LABEL[d.status]}`);
  if (d.deadline && end.getTime() !== existing.endDate.getTime()) changes.push(`deadline moved to ${formatDate(end)}`);
  if (d.ownerId !== undefined && d.ownerId !== existing.ownerId) changes.push("has a new owner");
  if (changes.length) {
    await notifyTeam(updated.id, gate.principal.id, { type: "PROJECT_UPDATED", title: `${updated.title} ${changes[0]}`, body: changes.join(" · ") });
  }
  return NextResponse.json({ project: { ...updated, status: normalizeProjectStatus(updated.status) } });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("delete", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "delete");
  if (!found.project) return apiError("That project doesn't exist", found.status);
  const files = await prisma.file.findMany({ where: { projectId: params.id }, select: { storedName: true } });
  await prisma.task.updateMany({ where: { projectId: params.id }, data: { projectId: null } });
  await prisma.project.delete({ where: { id: params.id } });
  // The rows cascade; the stored bytes are removed here.
  for (const f of files) await remove(f.storedName);
  return NextResponse.json({ ok: true });
}
