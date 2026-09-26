/**
 * Task lifecycle and deadline rules — pure, unit-tested
 * (tests/tasks-domain.test.ts), formulas in docs/METRICS.md.
 *
 * Status flow (Phase 2): NOT_STARTED → IN_PROGRESS → REVIEW → COMPLETED.
 * Moving forward one step, back one step (review sends work back), or
 * straight to COMPLETED from anywhere (small tasks need no ceremony) are
 * allowed; COMPLETED can be reopened to IN_PROGRESS. Nothing else.
 *
 * Stored values written before Phase 2 ("OPEN", "DONE") are read as their new
 * names until the backfill rewrites them — the same expand/contract rule as
 * roles (ADR-008).
 */

export const TASK_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "REVIEW", "COMPLETED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  REVIEW: "Review",
  COMPLETED: "Completed",
};

export const LEGACY_TASK_STATUSES: Readonly<Record<string, TaskStatus>> = {
  OPEN: "NOT_STARTED",
  DONE: "COMPLETED",
};

export function normalizeTaskStatus(raw: unknown): TaskStatus {
  if (typeof raw === "string") {
    if ((TASK_STATUSES as readonly string[]).includes(raw)) return raw as TaskStatus;
    if (LEGACY_TASK_STATUSES[raw]) return LEGACY_TASK_STATUSES[raw];
  }
  // An unreadable status is treated as not started: visible and actionable,
  // never silently counted as done.
  return "NOT_STARTED";
}

/** Every stored spelling of a status, for database filters. */
export function storedTaskStatuses(...statuses: TaskStatus[]): string[] {
  return statuses.flatMap((status) => [
    status,
    ...Object.entries(LEGACY_TASK_STATUSES)
      .filter(([, mapped]) => mapped === status)
      .map(([legacy]) => legacy),
  ]);
}

export const OPEN_STATUSES: readonly TaskStatus[] = ["NOT_STARTED", "IN_PROGRESS", "REVIEW"];

export function isOpen(status: TaskStatus): boolean {
  return status !== "COMPLETED";
}

export function canMove(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  if (to === "COMPLETED") return true;
  if (from === "COMPLETED") return to === "IN_PROGRESS";
  const a = TASK_STATUSES.indexOf(from);
  const b = TASK_STATUSES.indexOf(to);
  return Math.abs(a - b) === 1;
}

// ---------------------------------------------------------------------------
// Deadlines
// ---------------------------------------------------------------------------

/** How close a deadline must be to count as "approaching". */
export const APPROACHING_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DeadlineState = "NONE" | "ON_TRACK" | "APPROACHING" | "OVERDUE" | "DONE_ON_TIME" | "DONE_LATE";

/**
 * Where a task stands against its deadline. `deadline` is the instant the
 * task is due — callers pass the end of the due day on the company clock
 * (`lib/date.ts · dueDeadline`), so "due Friday" means "by the end of Friday".
 */
export function deadlineState(input: {
  status: TaskStatus;
  deadline: Date | null;
  completedAt: Date | null;
  now: Date;
}): DeadlineState {
  const { status, deadline, completedAt, now } = input;
  if (!deadline) return "NONE";
  if (status === "COMPLETED") {
    return completedAt && completedAt.getTime() <= deadline.getTime() ? "DONE_ON_TIME" : "DONE_LATE";
  }
  if (now.getTime() > deadline.getTime()) return "OVERDUE";
  if (deadline.getTime() - now.getTime() <= APPROACHING_WINDOW_MS) return "APPROACHING";
  return "ON_TRACK";
}

/**
 * On-time delivery rate: of the tasks completed that had a deadline, the
 * share completed by it. Null (not 0) when none qualify — no work is not
 * bad work.
 */
export function onTimeRate(
  tasks: readonly { status: TaskStatus; deadline: Date | null; completedAt: Date | null }[],
): number | null {
  const judged = tasks.filter((t) => t.status === "COMPLETED" && t.deadline);
  if (judged.length === 0) return null;
  const onTime = judged.filter((t) => t.completedAt && t.completedAt.getTime() <= t.deadline!.getTime());
  return onTime.length / judged.length;
}

/**
 * Workload: open task hours against weekly capacity. A task with no estimate
 * counts as `DEFAULT_TASK_HOURS`. Returned as a fraction (1 = full); may
 * exceed 1 — overload is information, not an error.
 */
export const DEFAULT_TASK_HOURS = 2;

export function workload(openTasks: number, weeklyCapacityHours: number): number | null {
  if (weeklyCapacityHours <= 0) return null;
  return (openTasks * DEFAULT_TASK_HOURS) / weeklyCapacityHours;
}
