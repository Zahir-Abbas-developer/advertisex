"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Avatar } from "@/components/ui/Avatar";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { AXIS, CHART, CURSOR, TOOLTIP } from "@/components/charts/theme";
import { ScheduleBadge } from "@/components/projects/shared/badges";
import { formatDate } from "@/lib/date";
import { PROJECT_STATUS_LABEL, type ProjectStatus, type Schedule } from "@/modules/projects/domain";

type Payload = {
  totals: { active: number; completed: number; delayed: number; upcomingDeadlines: number; averageProgress: number | null };
  byStatus: { status: ProjectStatus; count: number }[];
  delayed: { id: string; title: string; client: { businessName: string }; owner: { name: string } | null; deadline: string; schedule: Schedule; daysOverdue: number; progress: number }[];
  upcoming: { id: string; title: string; client: { businessName: string }; deadline: string; progress: number }[];
  assignments: { user: { id: string; name: string; avatarColor: string }; projects: number; milestones: number; tasks: number }[];
  trend: { month: string; completed: number; started: number }[];
};

const monthLabel = (key: string) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short" });

/** Founder Projects analytics (Phase 4 scope 4). Definitions: docs/METRICS.md. */
export function ProjectsAnalytics() {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/projects/analytics", { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Projects" title="Projects analytics" description="What's running, what's late, what's due, and who is carrying it — every number defined in the metrics doc." />
      {failed ? (
        <ErrorState title="Analytics didn't load" onRetry={() => void load()} />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-card" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Active" value={String(data.totals.active)} hint="Planning, active or on hold" />
            <StatCard label="Completed" value={String(data.totals.completed)} hint="All time" />
            <StatCard label="Delayed" value={String(data.totals.delayed)} hint="Past deadline or behind schedule" />
            <StatCard label="Due in 14 days" value={String(data.totals.upcomingDeadlines)} hint="Open projects" />
            <StatCard label="Average progress" value={data.totals.averageProgress === null ? "—" : `${data.totals.averageProgress}%`} hint="Across open projects" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader title="Are we finishing as many projects as we start?" description="Projects started and completed per month" />
              <CardBody>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.trend} margin={{ left: -20, right: 8, top: 8 }}>
                      <CartesianGrid stroke={CHART.line} vertical={false} />
                      <XAxis dataKey="month" tickFormatter={monthLabel} {...AXIS} />
                      <YAxis allowDecimals={false} {...AXIS} />
                      <Tooltip cursor={CURSOR} contentStyle={TOOLTIP} labelFormatter={(l) => monthLabel(String(l))} />
                      <Legend wrapperStyle={{ fontSize: 12, color: CHART.ink, opacity: 0.7 }} />
                      <Bar dataKey="started" name="Started" fill={CHART.data2} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="completed" name="Completed" fill={CHART.data1} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Where do projects stand?" description="Projects by status" />
              <CardBody>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.byStatus.map((s) => ({ ...s, label: PROJECT_STATUS_LABEL[s.status] }))} layout="vertical" margin={{ left: 10, right: 16 }}>
                      <CartesianGrid stroke={CHART.line} horizontal={false} />
                      <XAxis type="number" allowDecimals={false} {...AXIS} />
                      <YAxis type="category" dataKey="label" width={80} {...AXIS} />
                      <Tooltip cursor={CURSOR} contentStyle={TOOLTIP} />
                      <Bar dataKey="count" name="Projects" fill={CHART.data1} radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Delayed projects" description="Past their deadline, or more than 25 points behind the calendar." />
            {data.delayed.length ? (
              <TableShell>
                <Table>
                  <THead>
                    <TR>
                      <TH>Project</TH>
                      <TH>Client</TH>
                      <TH>Owner</TH>
                      <TH>Deadline</TH>
                      <TH className="w-40">Progress</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {data.delayed.map((p) => (
                      <TR key={p.id}>
                        <TD>
                          <Link href={`/projects/${p.id}`} className="font-medium text-ink hover:text-brand">
                            {p.title}
                          </Link>
                        </TD>
                        <TD className="text-ink/70">{p.client.businessName}</TD>
                        <TD className="text-ink/70">{p.owner?.name ?? "—"}</TD>
                        <TD className="tabular-nums text-ink/70">{formatDate(p.deadline)}</TD>
                        <TD>
                          <ProgressBar value={p.progress} showValue size="sm" tone={p.schedule === "OVERDUE" ? "danger" : "warn"} />
                        </TD>
                        <TD>
                          <ScheduleBadge schedule={p.schedule} daysOverdue={p.daysOverdue} />
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableShell>
            ) : (
              <EmptyState title="Nothing is delayed" description="Every open project is on track." className="py-8" />
            )}
          </Card>

          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader title="Upcoming deadlines" description="Open projects due in the next 14 days" />
              <CardBody>
                {data.upcoming.length ? (
                  <ul className="divide-y divide-line">
                    {data.upcoming.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                        <Link href={`/projects/${p.id}`} className="min-w-0 flex-1 truncate text-ink hover:text-brand">
                          {p.title} <span className="text-ink/45">· {p.client.businessName}</span>
                        </Link>
                        <span className="w-24">
                          <ProgressBar value={p.progress} size="sm" />
                        </span>
                        <span className="w-24 text-right tabular-nums text-ink/60">{formatDate(p.deadline)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink/45">No deadlines in the next two weeks.</p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Assignments" description="Open projects, and open milestones and tasks inside them, per person" />
              <CardBody>
                {data.assignments.length ? (
                  <ul className="divide-y divide-line">
                    {data.assignments.map((a) => (
                      <li key={a.user.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                        <Avatar name={a.user.name} color={a.user.avatarColor} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-ink">{a.user.name}</span>
                        <span className="tabular-nums text-ink/70">{a.projects} projects</span>
                        <span className="w-28 text-right tabular-nums text-ink/50">
                          {a.milestones} ms · {a.tasks} tasks
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink/45">No one is on an open project.</p>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
