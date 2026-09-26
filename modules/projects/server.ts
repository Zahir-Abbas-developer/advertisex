import type { Prisma } from "@prisma/client";

import { prisma, transaction, type TransactionClient } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { dueDeadline } from "@/lib/date";
import { notify } from "@/lib/notifications";
import type { NotificationType } from "@/lib/notification-types";
import { normalizeTaskStatus } from "@/modules/tasks/domain";
import { authorize, type Principal } from "@/modules/rbac/authorize";
import { storedRoleValues, type Action, type Role } from "@/config/permissions";
import { FALLBACK_STAGES } from "@/modules/services/catalog";
import {
  daysOverdue,
  projectProgress,
  projectSchedule,
  type Progress,
  type ProjectPriority,
  type ProjectStatus,
  type Schedule,
} from "@/modules/projects/domain";

/**
 * Projects on the server (Phase 4): who may see which, the one path that
 * creates a project (and its plan), and the batched progress/schedule
 * summaries every list and chart reads.
 */

/** The projects a principal may list. Null: none at all. */
export function projectScopeWhere(principal: Principal): Prisma.ProjectWhereInput | null {
  switch (principal.role) {
    case "FOUNDER":
      return {};
    case "MANAGER":
      return { client: { departmentId: { in: [...principal.departmentIds] } } };
    case "EMPLOYEE":
      return { id: { in: [...principal.assignedProjectIds] } };
    default:
      return null;
  }
}

type ProjectRef = { id: string; organizationId: string | null; client: { departmentId: string } };

export function projectTarget(p: ProjectRef) {
  return { organizationId: p.organizationId, departmentId: p.client.departmentId, projectId: p.id };
}

export function canOnProject(principal: Principal, action: Action, p: ProjectRef): boolean {
  return authorize(principal, action, "project", projectTarget(p)).allowed;
}

/** May this principal change the plan's shape (not just its progress)? */
export function canShapeProject(principal: Principal, p: ProjectRef): boolean {
  return principal.role !== "EMPLOYEE" && canOnProject(principal, "update", p);
}

/** Loads a project for an action, or says why not (404 hides existence). */
export async function projectFor(principal: Principal, id: string, action: Action) {
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, organizationId: true, clientId: true, title: true, status: true, ownerId: true, client: { select: { departmentId: true, businessName: true } } },
  });
  if (!project) return { project: null, status: 404 as const };
  if (!canOnProject(principal, action, project)) {
    return { project: null, status: canOnProject(principal, "read", project) ? (403 as const) : (404 as const) };
  }
  return { project, status: 200 as const };
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

export type ProjectSummary = {
  progress: Progress;
  schedule: Schedule;
  daysOverdue: number;
  deadline: Date;
  openMilestones: number;
  openTasks: number;
};

/** Progress and schedule for many projects in four queries. */
export async function summarize(
  projects: readonly { id: string; status: string; startDate: Date; endDate: Date }[],
  now = new Date(),
): Promise<Map<string, ProjectSummary>> {
  const ids = projects.map((p) => p.id);
  const out = new Map<string, ProjectSummary>();
  if (ids.length === 0) return out;

  const [timeZone, milestones, tasks, stages] = await Promise.all([
    companyTimezone(),
    prisma.projectMilestone.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, weight: true, status: true } }),
    prisma.task.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, status: true } }),
    prisma.projectStage.findMany({ where: { projectId: { in: ids } }, select: { projectId: true, status: true } }),
  ]);

  const group = <T extends { projectId: string | null }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) if (r.projectId) m.set(r.projectId, [...(m.get(r.projectId) ?? []), r]);
    return m;
  };
  const ms = group(milestones);
  const ts = group(tasks);
  const ss = group(stages);

  for (const p of projects) {
    const m = (ms.get(p.id) ?? []).map((x) => ({ weight: x.weight, done: x.status === "DONE" }));
    const t = (ts.get(p.id) ?? []).map((x) => ({ done: normalizeTaskStatus(x.status) === "COMPLETED" }));
    const progress = projectProgress({ status: p.status, milestones: m, tasks: t, stages: (ss.get(p.id) ?? []).map((x) => ({ done: x.status === "DONE" })) });
    const deadline = dueDeadline(p.endDate, timeZone);
    out.set(p.id, {
      progress,
      schedule: projectSchedule({ status: p.status, percent: progress.percent, start: p.startDate, deadline, now }),
      daysOverdue: daysOverdue(deadline, now),
      deadline,
      openMilestones: m.filter((x) => !x.done).length,
      openTasks: t.filter((x) => !x.done).length,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Creating a project — the one path (the projects API and lead conversion)
// ---------------------------------------------------------------------------

export type PlanService = {
  id: string;
  name: string;
  stageTemplates: { name: string; order: number }[];
  skills: { skillId: string }[];
};

/** The active services, with their templates and skills, in the given order. */
export async function servicesForPlan(serviceIds: readonly string[]): Promise<PlanService[]> {
  if (serviceIds.length === 0) return [];
  const rows = await prisma.serviceCatalog.findMany({
    where: { id: { in: [...serviceIds] }, isActive: true },
    select: {
      id: true,
      name: true,
      stageTemplates: { select: { name: true, order: true }, orderBy: { order: "asc" } },
      skills: { select: { skillId: true } },
    },
  });
  return [...new Set(serviceIds)].map((id) => rows.find((r) => r.id === id)).filter((r): r is PlanService => Boolean(r));
}

/**
 * Writes a new project's plan inside the caller's transaction: its services,
 * a stage list per service copied from the service's template (the first
 * stage of each line active), and its required skills derived from the
 * services. A project with no services gets a generic plan.
 */
export async function writePlan(tx: TransactionClient, projectId: string, services: readonly PlanService[], now: Date) {
  if (services.length) {
    await tx.projectService.createMany({ data: services.map((s) => ({ projectId, serviceId: s.id })) });
  }
  const lines = services.length
    ? services.map((s) => ({ serviceId: s.id as string | null, names: s.stageTemplates.length ? s.stageTemplates.map((t) => t.name) : [...FALLBACK_STAGES] }))
    : [{ serviceId: null, names: [...FALLBACK_STAGES] }];
  for (const line of lines) {
    await tx.projectStage.createMany({
      data: line.names.map((name, order) => ({
        projectId,
        serviceId: line.serviceId,
        name,
        order,
        status: order === 0 ? "ACTIVE" : "PENDING",
        startedAt: order === 0 ? now : null,
      })),
    });
  }
  const skillIds = [...new Set(services.flatMap((s) => s.skills.map((k) => k.skillId)))];
  if (skillIds.length) {
    await tx.projectSkill.createMany({ data: skillIds.map((skillId) => ({ projectId, skillId, source: "DERIVED" })) });
  }
}

export type NewProject = {
  clientId: string;
  title: string;
  description?: string | null;
  serviceIds: string[];
  startDate: Date;
  endDate: Date;
  status: ProjectStatus;
  priority: ProjectPriority;
  ownerId: string | null;
  memberIds: string[];
};

export class ProjectError extends Error {
  constructor(message: string, readonly status: number, readonly fields?: Record<string, string>) {
    super(message);
  }
}

/** Humans and AI agents both work on projects; clients never do. */
const PROJECT_ROLES: Role[] = ["FOUNDER", "MANAGER", "EMPLOYEE", "AI_AGENT"];

/** Staff of this organization who may be put on a project. */
async function staffIds(ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.user.findMany({
    where: { id: { in: [...ids] }, isActive: true, role: { in: PROJECT_ROLES.flatMap(storedRoleValues) } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

export async function createProject(principal: Principal, input: NewProject) {
  const client = await prisma.client.findUnique({ where: { id: input.clientId }, select: { id: true, organizationId: true, departmentId: true, businessName: true } });
  if (!client) throw new ProjectError("That client doesn't exist", 404);
  if (!authorize(principal, "create", "project", { organizationId: client.organizationId, departmentId: client.departmentId }).allowed) {
    throw new ProjectError("You can't start projects for this client", 403);
  }
  if (input.endDate <= input.startDate) throw new ProjectError("Please fix the highlighted fields", 422, { endDate: "The deadline must be after the start" });

  const services = await servicesForPlan(input.serviceIds);
  if (services.length !== new Set(input.serviceIds).size) {
    throw new ProjectError("Please fix the highlighted fields", 422, { serviceIds: "One of those services isn't available" });
  }
  const people = [...new Set([...input.memberIds, ...(input.ownerId ? [input.ownerId] : [])])];
  const valid = await staffIds(people);
  if (people.some((id) => !valid.has(id))) {
    throw new ProjectError("Please fix the highlighted fields", 422, { memberIds: "Only active team members can be on a project" });
  }

  const now = new Date();
  const project = await transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        organizationId: client.organizationId,
        clientId: client.id,
        title: input.title,
        description: input.description ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        status: input.status,
        priority: input.priority,
        ownerId: input.ownerId,
        completedAt: input.status === "COMPLETED" ? now : null,
      },
      select: { id: true, title: true },
    });
    await writePlan(tx, created.id, services, now);
    if (people.length) {
      await tx.projectMember.createMany({
        data: people.map((userId) => ({ projectId: created.id, userId, role: userId === input.ownerId ? "LEAD" : "MEMBER" })),
      });
    }
    return created;
  });

  await notifyTeam(project.id, principal.id, {
    type: "PROJECT_CREATED",
    title: `New project: ${project.title}`,
    body: `${client.businessName} — you're on the team.`,
  });
  return project;
}

/** Tells a project's team (owner and members) something, except whoever did it. */
export async function notifyTeam(
  projectId: string,
  actorId: string | null,
  message: { type: NotificationType; title: string; body: string; dedupeKey?: (userId: string) => string },
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, members: { select: { userId: true } } },
  });
  if (!project) return 0;
  const recipients = new Set([...(project.ownerId ? [project.ownerId] : []), ...project.members.map((m) => m.userId)]);
  if (actorId) recipients.delete(actorId);
  let sent = 0;
  for (const userId of recipients) {
    if (
      await notify({
        userId,
        type: message.type,
        title: message.title,
        body: message.body,
        href: `/projects/${projectId}`,
        dedupeKey: message.dedupeKey?.(userId) ?? null,
      })
    ) {
      sent++;
    }
  }
  return sent;
}
