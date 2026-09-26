import { prisma } from "@/lib/prisma";
import { dueDeadline, formatDate } from "@/lib/date";
import { notify } from "@/lib/notifications";
import { OPEN_STATUSES, deadlineState, normalizeTaskStatus, storedTaskStatuses } from "@/modules/tasks/domain";

/**
 * The task deadline sweep — overdue detection as a scheduled job (Phase 2
 * scope 4), run each morning by /api/cron/follow-ups.
 *
 * For every open, assigned task with a due date: "deadline approaching" once
 * per task, "overdue" once per task per day. Deduped, so a retried or doubled
 * run can never notify twice.
 */
export async function sweepTaskDeadlines(now: Date, timeZone: string, todayKey: string) {
  const tasks = await prisma.task.findMany({
    where: {
      assigneeId: { not: null },
      dueAt: { not: null },
      status: { in: storedTaskStatuses(...OPEN_STATUSES) },
    },
    select: { id: true, title: true, assigneeId: true, dueAt: true, status: true },
  });

  let approaching = 0;
  let overdue = 0;

  for (const task of tasks) {
    const state = deadlineState({
      status: normalizeTaskStatus(task.status),
      deadline: dueDeadline(task.dueAt!, timeZone),
      completedAt: null,
      now,
    });

    if (state === "APPROACHING") {
      const sent = await notify({
        userId: task.assigneeId!,
        type: "DUE_TOMORROW",
        title: `Due soon: ${task.title}`,
        body: `Due ${formatDate(task.dueAt!)}.`,
        href: "/tasks",
        dedupeKey: `task-approaching:${task.id}`,
      });
      if (sent) approaching += 1;
    }

    if (state === "OVERDUE") {
      const sent = await notify({
        userId: task.assigneeId!,
        type: "OVERDUE",
        title: `Overdue: ${task.title}`,
        body: `It was due ${formatDate(task.dueAt!)}.`,
        href: "/tasks",
        dedupeKey: `task-overdue:${task.id}:${todayKey}`,
      });
      if (sent) overdue += 1;
    }
  }

  return { checked: tasks.length, approaching, overdue };
}
