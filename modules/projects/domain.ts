/**
 * Projects (Phase 4) — pure rules: statuses, progress, schedule, stages.
 * Formulas in docs/METRICS.md; pinned by tests/projects-domain.test.ts.
 */

export const PROJECT_STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  ON_HOLD: "On hold",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, "neutral" | "info" | "warning" | "success" | "danger"> = {
  PLANNING: "neutral",
  ACTIVE: "info",
  ON_HOLD: "warning",
  COMPLETED: "success",
  CANCELLED: "neutral",
};

/** Statuses of a project still being worked. */
export const OPEN_PROJECT_STATUSES: readonly ProjectStatus[] = ["PLANNING", "ACTIVE", "ON_HOLD"];

/**
 * Reads any stored status. The retainer module's "OVERDUE_CLOSEOUT" was a
 * closed cycle, so it reads as COMPLETED; anything unrecognised reads as
 * PLANNING — never as done.
 */
export function normalizeProjectStatus(raw: unknown): ProjectStatus {
  if (raw === "OVERDUE_CLOSEOUT") return "COMPLETED";
  return (PROJECT_STATUSES as readonly unknown[]).includes(raw) ? (raw as ProjectStatus) : "PLANNING";
}

export const isProjectStatus = (v: unknown): v is ProjectStatus =>
  (PROJECT_STATUSES as readonly unknown[]).includes(v);

export const isOpenProject = (status: unknown) => OPEN_PROJECT_STATUSES.includes(normalizeProjectStatus(status));

export const PROJECT_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type ProjectPriority = (typeof PROJECT_PRIORITIES)[number];
export const PROJECT_PRIORITY_LABEL: Record<ProjectPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};
export const isProjectPriority = (v: unknown): v is ProjectPriority =>
  (PROJECT_PRIORITIES as readonly unknown[]).includes(v);

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type ProgressInput = {
  status: string;
  milestones: readonly { weight: number; done: boolean }[];
  tasks: readonly { done: boolean }[];
  stages: readonly { done: boolean }[];
};

export type Progress = {
  percent: number;
  /** What the percent was computed from. */
  basis: "work" | "stages" | "completed" | "none";
  done: number;
  total: number;
};

/** A milestone's weight, clamped to 1–5 whatever is stored. */
export const milestoneWeight = (weight: number) => Math.min(5, Math.max(1, Math.round(weight || 1)));

/**
 * Progress % — explainable in one sentence: *the share of the project's
 * planned work that is done, where each milestone counts by its size (1–5)
 * and each task counts 1.*
 *
 *   work    Σ weight(done milestones) + #done tasks
 *           ÷ Σ weight(all milestones) + #tasks, rounded **down**
 *   stages  with no milestones or tasks yet: done stages ÷ stages, rounded down
 *   none    nothing planned yet: 0
 *
 * A COMPLETED project is 100. Rounding down means 100 only when every item
 * is done — "100%" never sits on an open task.
 */
export function projectProgress(input: ProgressInput): Progress {
  const status = normalizeProjectStatus(input.status);
  const mTotal = input.milestones.reduce((t, m) => t + milestoneWeight(m.weight), 0);
  const mDone = input.milestones.reduce((t, m) => t + (m.done ? milestoneWeight(m.weight) : 0), 0);
  const total = mTotal + input.tasks.length;
  const done = mDone + input.tasks.filter((t) => t.done).length;

  if (status === "COMPLETED") return { percent: 100, basis: "completed", done: total, total };
  if (total > 0) return { percent: Math.floor((done / total) * 100), basis: "work", done, total };

  const stagesDone = input.stages.filter((s) => s.done).length;
  if (input.stages.length > 0) {
    return { percent: Math.floor((stagesDone / input.stages.length) * 100), basis: "stages", done: stagesDone, total: input.stages.length };
  }
  return { percent: 0, basis: "none", done: 0, total: 0 };
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export type Schedule = "ON_TRACK" | "BEHIND" | "OVERDUE" | "CLOSED";

export const SCHEDULE_LABEL: Record<Schedule, string> = {
  ON_TRACK: "On track",
  BEHIND: "Behind schedule",
  OVERDUE: "Past deadline",
  CLOSED: "Closed",
};

/** How far behind the calendar progress may fall before a project is "behind". */
export const BEHIND_TOLERANCE_POINTS = 25;

/** The share of the project's calendar already used, 0–100. */
export function expectedProgress(start: Date, deadline: Date, now: Date): number {
  const span = deadline.getTime() - start.getTime();
  if (span <= 0) return now >= deadline ? 100 : 0;
  return Math.min(100, Math.max(0, ((now.getTime() - start.getTime()) / span) * 100));
}

/**
 * Where an open project stands against its dates:
 *
 *   OVERDUE   now is past the end of the deadline day
 *   BEHIND    progress trails the calendar by more than 25 points
 *             (e.g. 60% of the time gone, under 35% done). Not for ON_HOLD:
 *             a paused project is not expected to move.
 *   ON_TRACK  otherwise
 *   CLOSED    completed or cancelled
 *
 * "Delayed" means OVERDUE or BEHIND.
 */
export function projectSchedule(input: {
  status: string;
  percent: number;
  start: Date;
  /** The instant the deadline day ends (lib/date.ts · dueDeadline). */
  deadline: Date;
  now: Date;
}): Schedule {
  const status = normalizeProjectStatus(input.status);
  if (!OPEN_PROJECT_STATUSES.includes(status)) return "CLOSED";
  if (input.now > input.deadline) return "OVERDUE";
  if (status === "ON_HOLD") return "ON_TRACK";
  const expected = expectedProgress(input.start, input.deadline, input.now);
  return input.percent < expected - BEHIND_TOLERANCE_POINTS ? "BEHIND" : "ON_TRACK";
}

export const isDelayed = (schedule: Schedule) => schedule === "OVERDUE" || schedule === "BEHIND";

/** Whole days past the deadline, 0 when not past it. */
export function daysOverdue(deadline: Date, now: Date): number {
  return now > deadline ? Math.ceil((now.getTime() - deadline.getTime()) / 86_400_000) : 0;
}

/** Days before the deadline at which "deadline approaching" is raised. */
export const DEADLINE_WARNING_DAYS = 7;

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export const STAGE_STATUSES = ["PENDING", "ACTIVE", "DONE"] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

export type StageRow = { id: string; serviceId: string | null; order: number; status: string };

/**
 * The current stage of each service line in the project: the first stage,
 * in order, that isn't DONE. A line with every stage done has none.
 */
export function currentStages<T extends StageRow>(stages: readonly T[]): T[] {
  const byLine = new Map<string, T[]>();
  for (const s of stages) {
    const key = s.serviceId ?? "";
    byLine.set(key, [...(byLine.get(key) ?? []), s]);
  }
  const out: T[] = [];
  for (const line of byLine.values()) {
    const next = [...line].sort((a, b) => a.order - b.order).find((s) => s.status !== "DONE");
    if (next) out.push(next);
  }
  return out;
}

/**
 * Completing a stage: it becomes DONE and the next stage of its line becomes
 * ACTIVE (if pending). Starting or reopening a stage: it becomes ACTIVE and
 * any other ACTIVE stage of its line goes back to PENDING — one line never
 * has two active stages. Returns the rows to change.
 */
export function stageMove<T extends StageRow>(
  stages: readonly T[],
  stageId: string,
  to: StageStatus,
): { id: string; status: StageStatus }[] {
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return [];
  const line = stages.filter((s) => (s.serviceId ?? "") === (stage.serviceId ?? "")).sort((a, b) => a.order - b.order);
  const later = line.filter((s) => s.order > stage.order);
  const changes: { id: string; status: StageStatus }[] = [{ id: stage.id, status: to }];

  if (to === "DONE") {
    const next = later.find((s) => s.status !== "DONE");
    if (next && next.status === "PENDING") changes.push({ id: next.id, status: "ACTIVE" });
  } else if (to === "ACTIVE") {
    for (const s of line) if (s.id !== stage.id && s.status === "ACTIVE") changes.push({ id: s.id, status: "PENDING" });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Upcoming work
// ---------------------------------------------------------------------------

export type WorkItem = { id: string; kind: "MILESTONE" | "TASK"; title: string; dueAt: Date | null; done: boolean };

/**
 * Open milestones and tasks due within `days` (overdue ones included, first),
 * soonest first.
 */
export function upcomingWork(items: readonly WorkItem[], now: Date, days = 14): WorkItem[] {
  const horizon = now.getTime() + days * 86_400_000;
  return items
    .filter((i) => !i.done && i.dueAt && i.dueAt.getTime() <= horizon)
    .sort((a, b) => a.dueAt!.getTime() - b.dueAt!.getTime());
}
