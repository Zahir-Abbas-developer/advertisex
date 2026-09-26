import { prisma } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { dueDeadline, startOfCompanyDay } from "@/lib/date";
import { normalizeRole, storedRoleValues, type Role } from "@/config/permissions";
import type { Principal } from "@/modules/rbac/authorize";
import { month as attendanceMonth, monthOf, type MonthView } from "@/modules/attendance/server";
import {
  OPEN_STATUSES,
  deadlineState,
  normalizeTaskStatus,
  onTimeRate,
  storedTaskStatuses,
  workload,
} from "@/modules/tasks/domain";

/**
 * The team, as the founder and managers see it: who is on it, what they are
 * carrying, how they are delivering, and how they are attending — performance
 * and attendance kept apart, each from its own engine (docs/METRICS.md).
 *
 * Everyone here is a User: humans and AI agents share one model. Agents get
 * performance (they are assigned work) and never attendance.
 */

export type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  isAgent: boolean;
  jobTitle: string;
  avatarColor: string;
  employmentStatus: string;
  weeklyCapacityHours: number;
  departments: { id: string; shortLabel: string }[];
  skills: { name: string; proficiency: number }[];
};

/** Who a principal may see in the directory (matrix: employee:read). */
export async function directoryFor(principal: Principal): Promise<Member[]> {
  const scope =
    principal.role === "FOUNDER"
      ? {}
      : principal.role === "MANAGER"
        ? { departments: { some: { departmentId: { in: [...principal.departmentIds] } } } }
        : { id: principal.id };

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { notIn: storedRoleValues("CLIENT") },
      ...scope,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      jobTitle: true,
      avatarColor: true,
      employmentStatus: true,
      weeklyCapacityHours: true,
      departments: { select: { department: { select: { id: true, shortLabel: true } } } },
      skills: { select: { proficiency: true, skill: { select: { name: true } } }, orderBy: { proficiency: "desc" } },
    },
  });

  return users
    .map((u) => {
      const role = normalizeRole(u.role);
      if (!role) return null;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role,
        isAgent: role === "AI_AGENT",
        jobTitle: u.jobTitle,
        avatarColor: u.avatarColor,
        employmentStatus: u.employmentStatus,
        weeklyCapacityHours: u.weeklyCapacityHours,
        departments: u.departments.map((m) => m.department),
        skills: u.skills.map((s) => ({ name: s.skill.name, proficiency: s.proficiency })),
      };
    })
    .filter((m): m is Member => m !== null)
    // By role rank, not by the stored string: legacy and current spellings
    // would otherwise interleave ("ADMIN" < "AI_AGENT" < "EMPLOYEE" < "MEMBER").
    .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.name.localeCompare(b.name));
}

const ROLE_RANK: Record<Role, number> = { FOUNDER: 0, MANAGER: 1, EMPLOYEE: 2, AI_AGENT: 3, CLIENT: 4 };

export type Performance = {
  userId: string;
  openTasks: number;
  tasksCompleted: number;
  tasksOverdue: number;
  /** Completed in the period with a deadline — the on-time denominator. */
  completedWithDeadline: number;
  completedOnTime: number;
  onTimeRate: number | null;
  workload: number | null;
  projectsDelivered: number;
};

/**
 * Delivery for a set of people over [from, to). Formulas: docs/METRICS.md,
 * "tasks and performance". Deadlines are the end of the due day on the
 * company clock.
 */
export async function performanceFor(
  users: readonly { id: string; weeklyCapacityHours: number }[],
  from: Date,
  to: Date,
  now = new Date(),
): Promise<Map<string, Performance>> {
  const ids = users.map((u) => u.id);
  const timezone = await companyTimezone();

  const [tasks, projectsByTask, projectsByMilestone] = await Promise.all([
    prisma.task.findMany({
      where: {
        assigneeId: { in: ids },
        OR: [
          { status: { in: storedTaskStatuses(...OPEN_STATUSES) } },
          { completedAt: { gte: from, lt: to } },
        ],
      },
      select: { assigneeId: true, status: true, dueAt: true, completedAt: true },
    }),
    prisma.task.findMany({
      where: {
        assigneeId: { in: ids },
        project: { status: "COMPLETED", closedOutAt: { gte: from, lt: to } },
      },
      select: { assigneeId: true, projectId: true },
      distinct: ["assigneeId", "projectId"],
    }),
    prisma.milestone.findMany({
      where: {
        assigneeId: { in: ids },
        module: { project: { status: "COMPLETED", closedOutAt: { gte: from, lt: to } } },
      },
      select: { assigneeId: true, module: { select: { projectId: true } } },
    }),
  ]);

  const result = new Map<string, Performance>();
  for (const user of users) {
    const mine = tasks
      .filter((t) => t.assigneeId === user.id)
      .map((t) => ({
        status: normalizeTaskStatus(t.status),
        deadline: t.dueAt ? dueDeadline(t.dueAt, timezone) : null,
        completedAt: t.completedAt,
      }));
    const open = mine.filter((t) => t.status !== "COMPLETED");
    const completedInRange = mine.filter(
      (t) => t.status === "COMPLETED" && t.completedAt && t.completedAt >= from && t.completedAt < to,
    );
    const delivered = new Set<string>([
      ...projectsByTask.filter((p) => p.assigneeId === user.id && p.projectId).map((p) => p.projectId!),
      ...projectsByMilestone.filter((m) => m.assigneeId === user.id).map((m) => m.module.projectId),
    ]);

    result.set(user.id, {
      userId: user.id,
      openTasks: open.length,
      tasksCompleted: completedInRange.length,
      tasksOverdue: open.filter((t) => deadlineState({ ...t, now }) === "OVERDUE").length,
      completedWithDeadline: completedInRange.filter((t) => t.deadline).length,
      completedOnTime: completedInRange.filter((t) => deadlineState({ ...t, now }) === "DONE_ON_TIME").length,
      onTimeRate: onTimeRate(completedInRange),
      workload: workload(open.length, user.weeklyCapacityHours),
      projectsDelivered: delivered.size,
    });
  }
  return result;
}

/** Attendance for everyone it applies to — never AI agents. */
export async function attendanceFor(
  members: readonly Member[],
  monthKey?: string,
  now = new Date(),
): Promise<Map<string, MonthView>> {
  const key = monthKey ?? monthOf(now, await companyTimezone());
  const humans = members.filter((m) => !m.isAgent);
  const views = await Promise.all(humans.map((m) => attendanceMonth(m.id, key, now)));
  return new Map(humans.map((m, i) => [m.id, views[i]]));
}

/**
 * A "YYYY-MM" month as [start, next month's start), on the company clock —
 * so a task finished at 22:00 in New York on the 31st counts in that month,
 * not the next. (Noon is used to pick the calendar day safely, whatever the
 * offset.)
 */
export function monthBounds(monthKey: string, timezone: string): { from: Date; to: Date } {
  const [y, m] = monthKey.split("-").map(Number);
  return {
    from: startOfCompanyDay(new Date(Date.UTC(y, m - 1, 1, 12)), timezone),
    to: startOfCompanyDay(new Date(Date.UTC(y, m, 1, 12)), timezone),
  };
}

export type ActivityEntry = {
  id: string;
  action: string;
  entityType: string;
  summary: string;
  actorName: string | null;
  actorType: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
};

/**
 * A person's activity feed, read from the audit log (Phase 2 scope 7):
 * everything they did, and every change to their profile, skills, schedule,
 * attendance and the tasks assigned to them.
 */
export async function activityFor(userId: string, take = 50): Promise<ActivityEntry[]> {
  const [tasks, days, breaks, skills, schedule] = await Promise.all([
    prisma.task.findMany({ where: { assigneeId: userId }, select: { id: true } }),
    prisma.attendanceDay.findMany({ where: { userId }, select: { id: true } }),
    prisma.breakSession.findMany({ where: { userId }, select: { id: true } }),
    prisma.userSkill.findMany({ where: { userId }, select: { id: true } }),
    prisma.workSchedule.findUnique({ where: { userId }, select: { id: true } }),
  ]);
  const about = [
    userId,
    ...tasks.map((r) => r.id),
    ...days.map((r) => r.id),
    ...breaks.map((r) => r.id),
    ...skills.map((r) => r.id),
    ...(schedule ? [schedule.id] : []),
  ];

  const entries = await prisma.auditLog.findMany({
    where: { OR: [{ actorId: userId }, { entityId: { in: about } }] },
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { name: true } } },
  });

  const parse = (json: string | null) => (json ? (JSON.parse(json) as Record<string, unknown>) : null);
  return entries.map((e) => ({
    id: e.id,
    action: e.action,
    entityType: e.entityType,
    summary: e.summary,
    actorName: e.actor?.name ?? null,
    actorType: e.actorType,
    before: parse(e.beforeJson),
    after: parse(e.afterJson),
    createdAt: e.createdAt.toISOString(),
  }));
}
