import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatCard } from "@/components/ui/StatCard";
import { prisma } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { dueDeadline } from "@/lib/date";
import { formatMinutes } from "@/modules/attendance/domain";
import { month as attendanceMonth, monthOf } from "@/modules/attendance/server";
import { monthBounds, performanceFor } from "@/modules/team/server";
import {
  OPEN_STATUSES,
  TASK_STATUS_LABEL,
  deadlineState,
  normalizeTaskStatus,
  storedTaskStatuses,
} from "@/modules/tasks/domain";

import { taskBoard } from "@/lib/tasks";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { summarize } from "@/modules/projects/server";
import { isDelayed, OPEN_PROJECT_STATUSES, SCHEDULE_LABEL } from "@/modules/projects/domain";
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

type Item = {
  id: string;
  title: string;
  status: ReturnType<typeof normalizeTaskStatus>;
  priority: string;
  dueAt: Date | null;
  state: ReturnType<typeof deadlineState>;
  project: string | null;
};

function TaskList({ items, empty }: { items: Item[]; empty: string }) {
  if (items.length === 0) return <p className="px-4 py-5 text-[13px] text-ink-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {items.map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] text-ink">{t.title}</p>
            {t.project && <p className="truncate text-[12px] text-ink-muted">{t.project}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {t.dueAt && (
              <span className={t.state === "OVERDUE" ? "text-[12px] tabular-nums text-danger" : "text-[12px] tabular-nums text-ink-muted"}>
                {t.dueAt.toISOString().slice(5, 10).replace("-", "/")}
              </span>
            )}
            <Badge size="sm" tone={t.status === "REVIEW" ? "info" : t.status === "IN_PROGRESS" ? "warning" : "neutral"}>
              {TASK_STATUS_LABEL[t.status]}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        {count !== undefined && <span className="text-[12px] tabular-nums text-ink-muted">{count}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * The team shell's home (Phase 2 scope 5): My Work, then My Performance.
 * Task-first and calm — what needs doing, what is late, what is next — with
 * the person's own numbers underneath, defined the same way as everywhere.
 */
export async function MyWork({ userId, name, capacity }: { userId: string; name: string; capacity: number }) {
  const now = new Date();
  const timezone = await companyTimezone();
  const key = monthOf(now, timezone);
  const { from, to } = monthBounds(key, timezone);

  const [tasks, perf, attendance, board, myProjects] = await Promise.all([
    prisma.task.findMany({
      where: { assigneeId: userId, status: { in: storedTaskStatuses(...OPEN_STATUSES) } },
      orderBy: [{ dueAt: "asc" }],
      select: { id: true, title: true, status: true, priority: true, dueAt: true, project: { select: { title: true } } },
    }),
    performanceFor([{ id: userId, weeklyCapacityHours: capacity }], from, to, now),
    attendanceMonth(userId, key, now).catch(() => null),
    // Follow-ups come from the same place the founder's dashboard counts
    // them, so the two can never disagree about what is due.
    taskBoard(userId, false, { mineOnly: true }),
    // Phase 5: the moment someone is put on a project it's here, with the
    // role(s) they hold on it.
    prisma.project.findMany({
      where: { status: { in: [...OPEN_PROJECT_STATUSES] }, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
      orderBy: { endDate: "asc" },
      select: {
        id: true,
        title: true,
        status: true,
        startDate: true,
        endDate: true,
        client: { select: { businessName: true } },
        recommendations: { where: { chosenUserId: userId, status: { in: ["ACCEPTED", "OVERRIDDEN"] } }, select: { skill: { select: { name: true } } } },
        stages: { where: { status: "ACTIVE" }, select: { name: true }, take: 1 },
      },
    }),
  ]);
  const projectSummaries = await summarize(myProjects, now);
  const followUps = board.rows.filter((r) => r.kind === "FOLLOW_UP" && (r.bucket === "OVERDUE" || r.bucket === "TODAY"));
  const p = perf.get(userId)!;

  const items: Item[] = tasks.map((t) => {
    const status = normalizeTaskStatus(t.status);
    return {
      id: t.id,
      title: t.title,
      status,
      priority: t.priority,
      dueAt: t.dueAt,
      project: t.project?.title ?? null,
      state: deadlineState({ status, deadline: t.dueAt ? dueDeadline(t.dueAt, timezone) : null, completedAt: null, now }),
    };
  });
  const overdue = items.filter((t) => t.state === "OVERDUE");
  const priority = items.filter((t) => t.priority === "HIGH" && t.state !== "OVERDUE");
  const weekAhead = now.getTime() + 7 * 24 * 3600_000;
  const upcoming = items.filter((t) => t.state !== "OVERDUE" && t.dueAt && t.dueAt.getTime() <= weekAhead);
  const projects = [...new Set(items.map((t) => t.project).filter((x): x is string => Boolean(x)))];

  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", hourCycle: "h23" }).format(now));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-brand">My work</p>
          <h1 className="mt-2 font-display text-[30px] font-bold leading-tight tracking-[-0.02em] text-ink">
            {greeting}, {name.split(" ")[0]}
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {items.length === 0
              ? "Nothing open right now."
              : `${items.length} open task${items.length === 1 ? "" : "s"}${overdue.length ? `, ${overdue.length} overdue` : ""}.`}
            {projects.length > 0 && ` Projects: ${projects.join(", ")}.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/my-attendance" className="inline-flex items-center gap-1.5 rounded-pill border border-line px-4 py-2 text-[13px] text-ink/80 transition-colors hover:bg-surface-2">
            Time clock <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link href="/tasks" className="inline-flex items-center gap-1.5 rounded-pill bg-brand px-4 py-2 text-[13px] font-medium text-on-brand transition-colors hover:bg-brand-hover">
            All tasks <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      {items.length === 0 ? (
        <Card padded={false}>
          <EmptyState title="You're all clear" description="When work is assigned to you it lands here, most urgent first." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Overdue" count={overdue.length}>
            <TaskList items={overdue} empty="Nothing overdue." />
          </Panel>
          <Panel title="Priority" count={priority.length}>
            <TaskList items={priority} empty="No high-priority tasks." />
          </Panel>
          <Panel title="Due this week" count={upcoming.length}>
            <TaskList items={upcoming} empty="No deadlines in the next 7 days." />
          </Panel>
        </div>
      )}

      {myProjects.length > 0 && (
        <Panel title="Your projects" count={myProjects.length}>
          <ul className="divide-y divide-line">
            {myProjects.map((pr) => {
              const sum = projectSummaries.get(pr.id)!;
              return (
                <li key={pr.id}>
                  <Link href={`/projects/${pr.id}`} className="grid gap-2 px-4 py-3 hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium text-ink">{pr.title}</span>
                      <span className="block truncate text-[12px] text-ink-muted">
                        {pr.client.businessName}
                        {pr.recommendations.length ? ` · your role: ${pr.recommendations.map((r) => r.skill.name).join(", ")}` : ""}
                        {pr.stages[0] ? ` · now: ${pr.stages[0].name}` : ""}
                        {isDelayed(sum.schedule) ? ` · ${SCHEDULE_LABEL[sum.schedule].toLowerCase()}` : ""}
                      </span>
                    </span>
                    <ProgressBar value={sum.progress.percent} showValue size="sm" tone={sum.schedule === "OVERDUE" ? "danger" : sum.schedule === "BEHIND" ? "warn" : "brand"} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {followUps.length > 0 && (
        <Panel title="Follow-ups due" count={followUps.length}>
          <ul className="divide-y divide-line">
            {followUps.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <Link
                  href={f.record?.type === "CLIENT" ? `/clients/${f.record.id}` : `/pipeline?lead=${f.record?.id ?? ""}`}
                  className="min-w-0 truncate text-[13px] text-ink hover:text-brand"
                >
                  {f.title}
                </Link>
                <Badge size="sm" tone={f.bucket === "OVERDUE" ? "danger" : "warning"}>
                  {f.bucket === "OVERDUE" ? "Overdue" : "Today"}
                </Badge>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <section className="space-y-4">
        <div>
          <p className="eyebrow text-ink-muted">My performance · {key}</p>
          <p className="mt-1 text-[13px] text-ink-muted">Delivery and attendance are measured separately — definitions on your attendance page and in the team docs.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard label="Workload" value={pct(p.workload)} hint={`${p.openTasks} open · ${capacity}h/week`} />
          <StatCard label="Tasks completed" value={String(p.tasksCompleted)} />
          <StatCard label="On-time delivery" value={pct(p.onTimeRate)} />
          <StatCard label="Projects completed" value={String(p.projectsDelivered)} />
          <StatCard label="Hours worked" value={attendance ? formatMinutes(attendance.summary.workedMinutes) : "—"} />
          <StatCard label="Attendance" value={attendance ? pct(attendance.summary.attendanceRate) : "—"} />
        </div>
      </section>
    </div>
  );
}
