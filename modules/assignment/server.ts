import { prisma } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { dueDeadline } from "@/lib/date";
import { notify } from "@/lib/notifications";
import { logger, errorFields } from "@/lib/logger";
import { storedRoleValues, type Role } from "@/config/permissions";
import { OPEN_STATUSES, normalizeTaskStatus, storedTaskStatuses } from "@/modules/tasks/domain";
import { isDelayed, isOpenProject, OPEN_PROJECT_STATUSES } from "@/modules/projects/domain";
import { summarize } from "@/modules/projects/server";
import { aiProvider } from "@/modules/ai";
import { extractBriefSkills } from "@/modules/ai/skills";
import {
  ASSIGNMENT_MODES,
  deriveRequirements,
  evaluate,
  explain,
  explainGap,
  parseWeights,
  rank,
  rebalance,
  type AssignmentMode,
  type Candidate,
  type RolePlan,
  type ScoreContext,
  type Weights,
} from "@/modules/assignment/domain";

/**
 * Project assignment on the server (Phase 5): the real inputs for the pure
 * scoring in ./domain.ts, the stored recommendations and the founder's
 * decisions on them, AUTO mode, and the rebalancing sweep.
 */

/** Who can be put on a project. Founders plan; they are not candidates. */
const CANDIDATE_ROLES: Role[] = ["MANAGER", "EMPLOYEE", "AI_AGENT"];
/** How far back delivery history and override signals are read. */
const HISTORY_DAYS = 180;

export type AssignmentSettings = { mode: AssignmentMode; weights: Weights; rawWeights: Record<string, number>; roleHours: number };

export async function assignmentSettings(): Promise<AssignmentSettings> {
  const row = await prisma.settings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } });
  let raw: Record<string, number> = {};
  try {
    raw = JSON.parse(row.assignmentWeights) as Record<string, number>;
  } catch {
    raw = {};
  }
  return {
    mode: (ASSIGNMENT_MODES as readonly string[]).includes(row.assignmentMode) ? (row.assignmentMode as AssignmentMode) : "RECOMMEND",
    weights: parseWeights(row.assignmentWeights),
    rawWeights: raw,
    roleHours: Math.max(1, row.assignmentRoleHours),
  };
}

type ProjectWindow = { id: string; startDate: Date; endDate: Date; organizationId: string | null };

/** Every scoring input, from real data, for everyone who could be put on this project. */
export async function loadCandidates(project: ProjectWindow): Promise<Candidate[]> {
  const timeZone = await companyTimezone();
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
  const leaveUntil = new Date(project.startDate.getTime() + 14 * 86_400_000);

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { in: CANDIDATE_ROLES.flatMap(storedRoleValues) },
      ...(project.organizationId ? { organizationId: project.organizationId } : {}),
    },
    select: {
      id: true,
      name: true,
      role: true,
      employmentStatus: true,
      weeklyCapacityHours: true,
      skills: { select: { skillId: true, proficiency: true } },
    },
  });
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return [];

  const [tasks, milestones, memberships, leave] = await Promise.all([
    prisma.task.findMany({
      where: { assigneeId: { in: ids }, OR: [{ status: { in: storedTaskStatuses(...OPEN_STATUSES) } }, { completedAt: { gte: since } }] },
      select: { assigneeId: true, status: true, dueAt: true, completedAt: true },
    }),
    prisma.projectMilestone.findMany({
      where: { assigneeId: { in: ids }, OR: [{ status: "OPEN" }, { completedAt: { gte: since } }] },
      select: { assigneeId: true, status: true, dueDate: true, completedAt: true },
    }),
    prisma.projectMember.findMany({
      where: { userId: { in: ids }, project: { status: { in: [...OPEN_PROJECT_STATUSES] } } },
      select: { userId: true, projectId: true },
    }),
    prisma.leaveRequest.findMany({
      where: { userId: { in: ids }, status: "APPROVED", date: { gte: project.startDate, lt: leaveUntil } },
      select: { userId: true },
    }),
  ]);

  return users.map((u) => {
    const mineTasks = tasks.filter((t) => t.assigneeId === u.id);
    const mineMs = milestones.filter((m) => m.assigneeId === u.id);
    const openTasks = mineTasks.filter((t) => normalizeTaskStatus(t.status) !== "COMPLETED");
    const openMs = mineMs.filter((m) => m.status === "OPEN");
    const done = [
      ...mineTasks.filter((t) => normalizeTaskStatus(t.status) === "COMPLETED" && t.dueAt && t.completedAt).map((t) => ({ due: t.dueAt!, at: t.completedAt! })),
      ...mineMs.filter((m) => m.status === "DONE" && m.dueDate && m.completedAt).map((m) => ({ due: m.dueDate!, at: m.completedAt! })),
    ];
    const myProjects = memberships.filter((m) => m.userId === u.id);
    return {
      userId: u.id,
      name: u.name,
      isAgent: u.role === "AI_AGENT",
      employmentStatus: u.employmentStatus,
      skills: new Map(u.skills.map((s) => [s.skillId, s.proficiency])),
      weeklyCapacityHours: u.weeklyCapacityHours,
      openItems: openTasks.length + openMs.length,
      openProjectRoles: myProjects.length,
      itemsDueBeforeDeadline:
        openTasks.filter((t) => t.dueAt && t.dueAt <= project.endDate).length + openMs.filter((m) => m.dueDate && m.dueDate <= project.endDate).length,
      delivered: { withDue: done.length, onTime: done.filter((d) => d.at <= dueDeadline(d.due, timeZone)).length },
      leaveDays: leave.filter((l) => l.userId === u.id).length,
      onProject: myProjects.some((m) => m.projectId === project.id),
    } satisfies Candidate;
  });
}

/** Signals are per skill: a person's net overrides for exactly this role. */
async function signalsFor(skillId: string): Promise<Map<string, number>> {
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
  const rows = await prisma.assignmentRecommendation.findMany({
    where: { skillId, status: "OVERRIDDEN", decidedAt: { gte: since } },
    select: { recommendedUserId: true, chosenUserId: true },
  });
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.chosenUserId) m.set(r.chosenUserId, (m.get(r.chosenUserId) ?? 0) + 1);
    if (r.recommendedUserId) m.set(r.recommendedUserId, (m.get(r.recommendedUserId) ?? 0) - 1);
  }
  return m;
}

function windowWeeks(p: ProjectWindow) {
  return Math.max(1, (p.endDate.getTime() - p.startDate.getTime()) / (7 * 86_400_000));
}

/** The project's requirements, from its stored skills (with weights and sources). */
async function requirementsOf(projectId: string) {
  const rows = await prisma.projectSkill.findMany({ where: { projectId }, select: { skillId: true, weight: true, source: true, skill: { select: { name: true } } } });
  return deriveRequirements({
    services: [{ skills: rows.filter((r) => r.source === "DERIVED").map((r) => ({ skillId: r.skillId, name: r.skill.name, weight: r.weight })) }],
    brief: rows.filter((r) => r.source === "BRIEF").map((r) => ({ skillId: r.skillId, name: r.skill.name })),
    manual: rows.filter((r) => r.source === "MANUAL").map((r) => ({ skillId: r.skillId, name: r.skill.name, weight: r.weight })),
  });
}

/**
 * The team plan: role by role, heaviest first, each role scored with that
 * skill's override signals, and each chosen person carrying the role's load
 * into later roles (as `planTeam` in ./domain.ts does).
 */
export async function planFor(projectId: string): Promise<{ plan: RolePlan[]; ctx: ScoreContext; candidates: Candidate[] }> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, startDate: true, endDate: true, organizationId: true } });
  const settings = await assignmentSettings();
  const requirements = await requirementsOf(projectId);
  const candidates = await loadCandidates(project);
  const ctx: ScoreContext = { weights: settings.weights, roleHours: settings.roleHours, windowWeeks: windowWeeks(project), requirements };

  const plan: RolePlan[] = [];
  const planned = new Map<string, number>();
  for (const req of requirements) {
    const signals = await signalsFor(req.skillId);
    const pool = candidates.map((c) => ({ ...c, signal: signals.get(c.userId) ?? 0, plannedRoles: planned.get(c.userId) ?? 0 }));
    const { eligible, ineligible } = rank(pool, req.skillId, ctx);
    const [best, ...rest] = eligible;
    if (best) planned.set(best.userId, (planned.get(best.userId) ?? 0) + 1);
    plan.push({
      skillId: req.skillId,
      skillName: req.name,
      weight: req.weight,
      recommended: best ? { ...best, explanation: explain(best, req.name, "best") } : null,
      alternatives: rest.slice(0, 3).map((e) => ({ ...e, explanation: explain(e, req.name, "alternative", best) })),
      gap: best ? null : explainGap(req.name, ineligible),
    });
  }
  return { plan, ctx, candidates };
}

// ---------------------------------------------------------------------------
// Analysis: requirements (incl. the brief) → recommendations
// ---------------------------------------------------------------------------

export type AnalysisResult = { roles: number; gaps: number; aiUsed: boolean; aiError: string | null; briefSkills: string[] };

/**
 * Reads the brief for skills (when AI is configured), then scores every role
 * and stores one recommendation per role. Decided roles (accepted,
 * overridden, dismissed) are left exactly as decided; only open proposals
 * are refreshed, and proposals for skills no longer required are removed.
 */
export async function analyze(projectId: string, mode: AssignmentMode): Promise<AnalysisResult> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { description: true, organizationId: true } });

  // 1. The brief, read against the organization's own skills.
  const taxonomy = await prisma.skill.findMany({
    where: { isActive: true, ...(project.organizationId ? { organizationId: project.organizationId } : {}) },
    select: { id: true, name: true },
  });
  const ai = await extractBriefSkills(aiProvider(), project.description, taxonomy);
  if (ai.error) logger.warn("assignment.brief_ai_failed", { projectId, error: ai.error });
  if (ai.skills.length) {
    const existing = new Set((await prisma.projectSkill.findMany({ where: { projectId }, select: { skillId: true } })).map((s) => s.skillId));
    const fresh = ai.skills.filter((s) => !existing.has(s.id));
    if (fresh.length) await prisma.projectSkill.createMany({ data: fresh.map((s) => ({ projectId, skillId: s.id, source: "BRIEF", weight: 2 })) });
  }

  // 2. Score and store.
  const { plan } = await planFor(projectId);
  const decided = await prisma.assignmentRecommendation.findMany({
    where: { projectId, status: { in: ["ACCEPTED", "OVERRIDDEN", "DISMISSED"] } },
    select: { skillId: true },
  });
  const keep = new Set(decided.map((d) => d.skillId));
  await prisma.assignmentRecommendation.deleteMany({
    where: { projectId, status: { in: ["PROPOSED", "GAP"] }, skillId: { notIn: plan.map((p) => p.skillId) } },
  });
  for (const role of plan) {
    if (keep.has(role.skillId)) continue;
    const data = {
      recommendedUserId: role.recommended?.userId ?? null,
      score: role.recommended?.score ?? null,
      explanation: role.recommended?.explanation ?? role.gap ?? "",
      detail: JSON.stringify({
        weight: role.weight,
        components: role.recommended?.components ?? null,
        alternatives: role.alternatives.map((a) => ({ userId: a.userId, name: a.name, score: a.score, explanation: a.explanation, components: a.components })),
      }),
      status: role.recommended ? "PROPOSED" : "GAP",
      mode,
    };
    await prisma.assignmentRecommendation.upsert({
      where: { projectId_skillId: { projectId, skillId: role.skillId } },
      create: { projectId, skillId: role.skillId, ...data },
      update: data,
    });
  }
  return { roles: plan.length, gaps: plan.filter((p) => !p.recommended).length, aiUsed: ai.used, aiError: ai.error, briefSkills: ai.skills.map((s) => s.name) };
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

async function putOnProject(projectId: string, userId: string, skillName: string, projectTitle: string, actorId: string | null) {
  const existing = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId } } });
  if (!existing) await prisma.projectMember.create({ data: { projectId, userId, role: "MEMBER" } });
  if (userId !== actorId) {
    await notify({
      userId,
      type: "PROJECT_UPDATED",
      title: `You're on ${projectTitle}`,
      body: `Assigned for ${skillName}. The project and its tasks are on your dashboard.`,
      href: `/projects/${projectId}`,
    });
  }
}

export class AssignmentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * The founder's decision on one role: accept the recommendation, override it
 * with someone else (with an optional reason — the override is the signal
 * later scoring learns from), or dismiss it. Every decision is audit-logged
 * by the data layer, before and after.
 */
export async function decide(
  actorId: string,
  recommendationId: string,
  projectId: string,
  action: { kind: "ACCEPT" } | { kind: "OVERRIDE"; userId: string; reason?: string | null } | { kind: "DISMISS" },
  mode: AssignmentMode = "RECOMMEND",
) {
  const rec = await prisma.assignmentRecommendation.findFirst({
    where: { id: recommendationId, projectId },
    include: { skill: { select: { name: true } }, project: { select: { title: true } } },
  });
  if (!rec) throw new AssignmentError("That recommendation doesn't exist", 404);
  const now = new Date();

  if (action.kind === "DISMISS") {
    return prisma.assignmentRecommendation.update({ where: { id: rec.id }, data: { status: "DISMISSED", decidedById: actorId, decidedAt: now, mode } });
  }
  if (action.kind === "ACCEPT") {
    if (!rec.recommendedUserId) throw new AssignmentError("There's no one to accept for this role — choose someone instead", 422);
    const updated = await prisma.assignmentRecommendation.update({
      where: { id: rec.id },
      data: { status: "ACCEPTED", chosenUserId: rec.recommendedUserId, decidedById: mode === "AUTO" ? null : actorId, decidedAt: now, mode },
    });
    await putOnProject(projectId, rec.recommendedUserId, rec.skill.name, rec.project.title, actorId);
    return updated;
  }
  const chosen = await prisma.user.findUnique({ where: { id: action.userId }, select: { id: true, isActive: true, role: true } });
  if (!chosen?.isActive || !CANDIDATE_ROLES.flatMap(storedRoleValues).includes(chosen.role)) {
    throw new AssignmentError("Choose an active team member", 422);
  }
  // Choosing the recommended person is an accept, not an override.
  if (chosen.id === rec.recommendedUserId) return decide(actorId, recommendationId, projectId, { kind: "ACCEPT" }, mode);
  const updated = await prisma.assignmentRecommendation.update({
    where: { id: rec.id },
    data: { status: "OVERRIDDEN", chosenUserId: chosen.id, overrideReason: action.reason?.trim() || null, decidedById: actorId, decidedAt: now, mode },
  });
  await putOnProject(projectId, chosen.id, rec.skill.name, rec.project.title, actorId);
  return updated;
}

/**
 * After creation: AUTO accepts every role that has a recommendation (gaps
 * stay for the founder); RECOMMEND tells the founders and the project owner
 * that a team is waiting to be confirmed.
 */
export async function onProjectCreated(projectId: string, actorId: string) {
  try {
    const settings = await assignmentSettings();
    const result = await analyze(projectId, settings.mode);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { title: true, ownerId: true, organizationId: true } });
    if (settings.mode === "AUTO") {
      const recs = await prisma.assignmentRecommendation.findMany({ where: { projectId, status: "PROPOSED" }, select: { id: true } });
      for (const r of recs) await decide(actorId, r.id, projectId, { kind: "ACCEPT" }, "AUTO");
    } else if (result.roles > 0) {
      const deciders = await prisma.user.findMany({
        where: { isActive: true, role: { in: storedRoleValues("FOUNDER") }, ...(project.organizationId ? { organizationId: project.organizationId } : {}) },
        select: { id: true },
      });
      const to = new Set([...deciders.map((d) => d.id), ...(project.ownerId ? [project.ownerId] : [])]);
      to.delete(actorId);
      for (const userId of to) {
        await notify({
          userId,
          type: "PROJECT_UPDATED",
          title: `Team suggested for ${project.title}`,
          body: `${result.roles - result.gaps} of ${result.roles} roles have a recommendation${result.gaps ? `, ${result.gaps} need someone` : ""}. Confirm or change them.`,
          href: `/projects/${projectId}?tab=team`,
          dedupeKey: `team-suggested:${projectId}:${userId}`,
        });
      }
    }
    return result;
  } catch (error) {
    // Assignment advice must never fail the project it advises on.
    logger.error("assignment.analyze_failed", { projectId, ...errorFields(error) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rebalancing — suggestions, never silent changes
// ---------------------------------------------------------------------------

/**
 * For each open project's decided roles, is the holder still the right
 * person? Raises a ReassignmentSuggestion (and tells the founders) when
 * `rebalance()` says so. Deduped per project, role, holder and suggestion
 * per week, so a dismissed suggestion isn't re-raised the next morning.
 */
export async function sweepRebalance(now = new Date(), onlyProjectId?: string) {
  const projects = await prisma.project.findMany({
    where: { status: { in: [...OPEN_PROJECT_STATUSES] }, modules: { none: {} }, ...(onlyProjectId ? { id: onlyProjectId } : {}) },
    select: { id: true, title: true, status: true, startDate: true, endDate: true, organizationId: true, recommendations: { where: { status: { in: ["ACCEPTED", "OVERRIDDEN"] } }, select: { skillId: true, chosenUserId: true, skill: { select: { name: true } } } } },
  });
  const summaries = await summarize(projects, now);
  const settings = await assignmentSettings();
  const week = Math.floor(now.getTime() / (7 * 86_400_000));
  let raised = 0;

  for (const p of projects) {
    if (!isOpenProject(p.status) || p.recommendations.length === 0) continue;
    const requirements = await requirementsOf(p.id);
    const candidates = await loadCandidates(p);
    const ctx: ScoreContext = { weights: settings.weights, roleHours: settings.roleHours, windowWeeks: windowWeeks(p), requirements };
    const delayed = isDelayed(summaries.get(p.id)!.schedule);

    for (const role of p.recommendations) {
      if (!role.chosenUserId) continue;
      const holder = candidates.find((c) => c.userId === role.chosenUserId);
      const others = candidates.filter((c) => c.userId !== role.chosenUserId);
      const best = rank(others, role.skillId, ctx).eligible[0] ?? null;
      const current = holder
        ? evaluate({ ...holder, onProject: true }, role.skillId, ctx)
        : null;
      // A holder who is no longer a candidate at all (deactivated) can't cover it.
      const verdict = current ? rebalance(current, best, delayed) : { reason: "The person holding this role is no longer active", toUserId: best?.userId ?? null };
      if (!verdict) continue;
      const dedupeKey = `${p.id}:${role.skillId}:${role.chosenUserId}:${verdict.toUserId ?? "none"}:${week}`;
      const exists = await prisma.reassignmentSuggestion.findUnique({ where: { dedupeKey } });
      if (exists) continue;
      await prisma.reassignmentSuggestion.create({
        data: { projectId: p.id, skillId: role.skillId, fromUserId: role.chosenUserId, toUserId: verdict.toUserId, reason: verdict.reason, dedupeKey },
      });
      raised++;
      const founders = await prisma.user.findMany({
        where: { isActive: true, role: { in: storedRoleValues("FOUNDER") }, ...(p.organizationId ? { organizationId: p.organizationId } : {}) },
        select: { id: true },
      });
      for (const f of founders) {
        await notify({
          userId: f.id,
          type: "PROJECT_UPDATED",
          title: `Reassignment suggested on ${p.title}`,
          body: `${role.skill.name}: ${verdict.reason}.`,
          href: `/projects/${p.id}?tab=team`,
          dedupeKey: `reassign:${dedupeKey}:${f.id}`,
        });
      }
    }
  }
  return { checked: projects.length, raised };
}

/** Accepting a suggestion moves the role; dismissing it records the decision. */
export async function decideReassignment(actorId: string, suggestionId: string, projectId: string, accept: boolean) {
  const s = await prisma.reassignmentSuggestion.findFirst({
    where: { id: suggestionId, projectId, status: "OPEN" },
    include: { skill: { select: { name: true } }, project: { select: { title: true } } },
  });
  if (!s) throw new AssignmentError("That suggestion is no longer open", 404);
  const now = new Date();
  if (!accept || !s.toUserId) {
    if (accept && !s.toUserId) throw new AssignmentError("No one was suggested — choose someone on the role instead", 422);
    return prisma.reassignmentSuggestion.update({ where: { id: s.id }, data: { status: "DISMISSED", decidedById: actorId, decidedAt: now } });
  }
  await prisma.assignmentRecommendation.updateMany({
    where: { projectId, skillId: s.skillId },
    data: { status: "OVERRIDDEN", chosenUserId: s.toUserId, overrideReason: `Reassigned: ${s.reason}`, decidedById: actorId, decidedAt: now },
  });
  await putOnProject(projectId, s.toUserId, s.skill.name, s.project.title, actorId);
  if (s.fromUserId !== actorId) {
    await notify({
      userId: s.fromUserId,
      type: "PROJECT_UPDATED",
      title: `${s.project.title}: ${s.skill.name} handed over`,
      body: `The role moved on (${s.reason}). You stay on the project team.`,
      href: `/projects/${projectId}`,
    });
  }
  return prisma.reassignmentSuggestion.update({ where: { id: s.id }, data: { status: "ACCEPTED", decidedById: actorId, decidedAt: now } });
}

