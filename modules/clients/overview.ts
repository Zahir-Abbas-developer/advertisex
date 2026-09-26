import { prisma } from "@/lib/prisma";
import { normalizeTaskStatus } from "@/modules/tasks/domain";
import { clientHealth, type Health } from "@/modules/clients/health";
import { monthlyEquivalent } from "@/modules/services/catalog";
import { isOpenProject, normalizeProjectStatus, type ProjectStatus, type Schedule } from "@/modules/projects/domain";
import { summarize } from "@/modules/projects/server";

/**
 * Everything a client card or profile header shows about a client's state,
 * batched across many clients (Phase 4): health, the current project,
 * recurring value and active services.
 */

export type ClientOverview = {
  health: Health;
  openProjects: number;
  currentProject: { id: string; title: string; status: ProjectStatus; deadline: string; progress: number; schedule: Schedule } | null;
  /** Σ monthly equivalent of active services — the founder's figure. */
  monthlyRecurring: number;
  services: { id: string; name: string }[];
};

export async function clientOverviews(clientIds: readonly string[], now = new Date()): Promise<Map<string, ClientOverview>> {
  const out = new Map<string, ClientOverview>();
  if (clientIds.length === 0) return out;
  const ids = [...clientIds];

  const [projects, services, contracts] = await Promise.all([
    prisma.project.findMany({
      where: { clientId: { in: ids } },
      select: { id: true, clientId: true, title: true, status: true, startDate: true, endDate: true },
      orderBy: { endDate: "asc" },
    }),
    prisma.clientService.findMany({
      where: { clientId: { in: ids }, status: "ACTIVE" },
      select: { clientId: true, price: true, billing: true, service: { select: { id: true, name: true } } },
    }),
    prisma.contract.findMany({ where: { clientId: { in: ids } }, select: { clientId: true, status: true, endDate: true } }),
  ]);
  const open = projects.filter((p) => isOpenProject(p.status));
  const [summaries, milestones, tasks] = await Promise.all([
    summarize(open, now),
    prisma.projectMilestone.findMany({
      where: { project: { clientId: { in: ids } }, dueDate: { not: null } },
      select: { status: true, dueDate: true, completedAt: true, project: { select: { clientId: true } } },
    }),
    prisma.task.findMany({
      where: { clientId: { in: ids }, dueAt: { not: null } },
      select: { clientId: true, status: true, dueAt: true, completedAt: true },
    }),
  ]);

  for (const clientId of ids) {
    const mine = open.filter((p) => p.clientId === clientId);
    const current = mine[0] ?? null;
    const currentSummary = current ? summarizeOf(summaries, current.id) : null;

    // Delivery on time: milestones and tasks completed by the end of their due day.
    const done = [
      ...milestones.filter((m) => m.project.clientId === clientId && m.status === "DONE" && m.completedAt).map((m) => ({ due: m.dueDate!, at: m.completedAt! })),
      ...tasks.filter((t) => t.clientId === clientId && normalizeTaskStatus(t.status) === "COMPLETED" && t.completedAt).map((t) => ({ due: t.dueAt!, at: t.completedAt! })),
    ];
    const endOfDay = (d: Date) => d.getTime() + 86_400_000;
    const overdueItems =
      milestones.filter((m) => m.project.clientId === clientId && m.status !== "DONE" && endOfDay(m.dueDate!) < now.getTime()).length +
      tasks.filter((t) => t.clientId === clientId && normalizeTaskStatus(t.status) !== "COMPLETED" && endOfDay(t.dueAt!) < now.getTime()).length;

    const health = clientHealth({
      projects: mine.map((p) => {
        const s = summarizeOf(summaries, p.id);
        return { schedule: s.schedule, daysOverdue: s.daysOverdue };
      }),
      onTime: { onTime: done.filter((x) => x.at.getTime() <= endOfDay(x.due)).length, withDue: done.length },
      overdueItems,
      contracts: contracts.filter((c) => c.clientId === clientId),
      now,
    });

    const active = services.filter((s) => s.clientId === clientId);
    out.set(clientId, {
      health,
      openProjects: mine.length,
      currentProject:
        current && currentSummary
          ? {
              id: current.id,
              title: current.title,
              status: normalizeProjectStatus(current.status),
              deadline: current.endDate.toISOString().slice(0, 10),
              progress: currentSummary.progress.percent,
              schedule: currentSummary.schedule,
            }
          : null,
      monthlyRecurring: active.reduce((t, s) => t + monthlyEquivalent(s.price, s.billing), 0),
      services: active.map((s) => s.service),
    });
  }
  return out;
}

function summarizeOf(map: Awaited<ReturnType<typeof summarize>>, id: string) {
  return map.get(id)!;
}
