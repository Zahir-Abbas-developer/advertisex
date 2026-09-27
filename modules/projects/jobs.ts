import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/date";
import { notify } from "@/lib/notifications";
import { storedRoleValues } from "@/config/permissions";
import { DEADLINE_WARNING_DAYS, isDelayed, OPEN_PROJECT_STATUSES, SCHEDULE_LABEL } from "@/modules/projects/domain";
import { summarize } from "@/modules/projects/server";

/**
 * The delayed-project detection job (Phase 4 scope 4), run each morning by
 * /api/cron/follow-ups.
 *
 * - A project found delayed (past its deadline, or behind schedule) is
 *   stamped `delayedAt` and its team and the founder are told — once per
 *   delay, not every morning. When it is back on track the stamp clears, so
 *   a later slip is news again.
 * - A project whose deadline is within 7 days (and not already delayed)
 *   warns its team once per deadline date.
 *
 * Every notification is deduped, so a retried or doubled run never repeats.
 */
export async function sweepProjects(now: Date) {
  const projects = await prisma.project.findMany({
    // Retainer cycles (legacy workstreams) have their own lifecycle and no
    // Phase 4 plan; judged here they would all read as 0% and delayed.
    where: { status: { in: [...OPEN_PROJECT_STATUSES] }, modules: { none: {} } },
    select: {
      id: true,
      organizationId: true,
      title: true,
      status: true,
      startDate: true,
      endDate: true,
      delayedAt: true,
      ownerId: true,
      client: { select: { businessName: true } },
      owner: { select: { isActive: true } },
      members: { where: { user: { isActive: true } }, select: { userId: true } },
    },
  });
  const summaries = await summarize(projects, now);
  const founders = await prisma.user.findMany({
    where: { role: { in: storedRoleValues("FOUNDER") }, isActive: true },
    select: { id: true, organizationId: true },
  });

  let flagged = 0;
  let cleared = 0;
  let warned = 0;

  for (const p of projects) {
    const s = summaries.get(p.id)!;
    const team = new Set([...(p.ownerId && p.owner?.isActive ? [p.ownerId] : []), ...p.members.map((m) => m.userId)]);
    const deadlineKey = p.endDate.toISOString().slice(0, 10);

    if (isDelayed(s.schedule)) {
      if (!p.delayedAt) {
        await prisma.project.update({ where: { id: p.id }, data: { delayedAt: now } });
        flagged++;
        const recipients = new Set([...team, ...founders.filter((f) => f.organizationId === p.organizationId).map((f) => f.id)]);
        for (const userId of recipients) {
          await notify({
            userId,
            type: "PROJECT_DELAYED",
            title: `${p.title} is delayed`,
            body: `${p.client.businessName} — ${SCHEDULE_LABEL[s.schedule].toLowerCase()}, ${s.progress.percent}% done, deadline ${formatDate(p.endDate)}.`,
            href: `/projects/${p.id}`,
            // Per recipient: the key is unique across all notifications.
            dedupeKey: `project-delayed:${p.id}:${deadlineKey}:${now.toISOString().slice(0, 10)}:${userId}`,
          });
        }
      }
      continue;
    }
    if (p.delayedAt) {
      await prisma.project.update({ where: { id: p.id }, data: { delayedAt: null } });
      cleared++;
    }
    const daysLeft = (s.deadline.getTime() - now.getTime()) / 86_400_000;
    if (daysLeft >= 0 && daysLeft <= DEADLINE_WARNING_DAYS) {
      for (const userId of team) {
        if (
          await notify({
            userId,
            type: "PROJECT_DEADLINE",
            title: `${p.title} is due ${formatDate(p.endDate)}`,
            body: `${p.client.businessName} — ${s.progress.percent}% done.`,
            href: `/projects/${p.id}`,
            dedupeKey: `project-deadline:${p.id}:${deadlineKey}:${userId}`,
          })
        ) {
          warned++;
        }
      }
    }
  }
  return { checked: projects.length, flagged, cleared, warned };
}
