"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Avatar } from "@/components/ui/Avatar";
import { AXIS, CHART, CURSOR, TOOLTIP } from "@/components/charts/theme";
import { safeFetch } from "@/lib/safe-fetch";
import { formatMoney } from "@/modules/billing/money";
import { PERIOD_LABEL, PERIODS, type Period } from "@/modules/analytics/domain";
import type { CommandCenter as Data } from "@/modules/analytics/server";
import { bucketLabel, Kpi, Section, Shares } from "@/components/command/parts";
import { AnnouncementsPanel } from "@/components/command/AnnouncementsPanel";

/**
 * The founder Command Center (Phase 8 scope 1): leads, outreach, money,
 * projects and the team for a period, each figure against the period before.
 * One question per chart; the numbers come from /api/command (docs/METRICS.md).
 */
export function CommandCenter() {
  const [period, setPeriod] = useState<Period>("30d");
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/command?period=${period}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData((await res.json()).command);
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="eyebrow text-brand">Command center</p>
        <h2 className="mt-1 font-display text-[22px] font-bold tracking-[-0.02em] text-ink">How the business is doing</h2>
        {data && (
          <p className="mt-1 text-[13px] text-ink-muted">
            {data.bounds.from} to {data.bounds.to}, compared with {data.bounds.prevFrom} to {data.bounds.prevTo}.
          </p>
        )}
      </div>
      <div className="w-48">
        <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} />
      </div>
    </div>
  );

  if (failed) return <div className="space-y-6">{header}<ErrorState title="The command center didn't load" onRetry={() => void load()} /></div>;
  if (!data) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-card" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-card" />
      </div>
    );
  }

  const money = (minor: number) => formatMoney(minor, data.revenue.currency, { whole: true });
  const g = data.bounds.granularity;
  const tick = (v: string) => bucketLabel(v, g);
  const pct = (v: number | null) => (v === null ? "—" : `${v}%`);

  return (
    <div className="space-y-10">
      {header}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi hero label="Payments received" value={money(data.revenue.received.value)} d={data.revenue.received} money={money} />
        <Kpi label="New leads" value={data.leads.newLeads.value.toLocaleString()} d={data.leads.newLeads} />
        <Kpi label="Deals won" value={data.leads.won.value.toLocaleString()} d={data.leads.won} />
        <Kpi label="Tasks completed" value={data.team.tasksCompleted.value.toLocaleString()} d={data.team.tasksCompleted} />
      </section>

      <Section title="Leads & sales" description="New business: what came in and what we won." action={<Link href="/pipeline/analytics" className="text-[13px] font-medium text-brand hover:underline">Leads analytics</Link>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Won value" value={money(data.leads.wonValue.value)} d={data.leads.wonValue} money={money} />
          <Kpi label="Conversion" value={pct(data.leads.conversion.available ? data.leads.conversion.value : null)} d={data.leads.conversion} points />
          <Kpi label="Open pipeline" value={money(data.leads.openPipelineMinor)} hint="Deal value in open stages, today" />
          <Kpi label="Outreach" value={data.outreach.total.value.toLocaleString()} d={data.outreach.total} />
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Card padded={false}>
            <CardHeader title="How many leads came in, and how many did we win?" description={PERIOD_LABEL[data.period]} />
            <CardBody>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.leads.trend} margin={{ left: -20, right: 8, top: 8 }}>
                    <CartesianGrid stroke={CHART.line} vertical={false} />
                    <XAxis dataKey="bucket" tickFormatter={tick} {...AXIS} minTickGap={16} />
                    <YAxis allowDecimals={false} {...AXIS} />
                    <Tooltip cursor={CURSOR} contentStyle={TOOLTIP} labelFormatter={(l) => tick(String(l))} />
                    <Legend wrapperStyle={{ fontSize: 12, color: CHART.ink }} />
                    <Bar dataKey="value" name="New leads" fill={CHART.data2} radius={[3, 3, 0, 0]} />
                    <Bar dataKey="won" name="Won" fill={CHART.data4} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>
          <Card padded={false}>
            <CardHeader title="Where do new leads come from?" description="By source" />
            <CardBody>
              <Shares rows={data.leads.bySource} empty="No new leads in this period." />
            </CardBody>
          </Card>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card padded={false}>
            <CardHeader title="What outreach did the team do?" description="Against the previous period" />
            <CardBody className="p-0 sm:p-0">
              <ul className="divide-y divide-line">
                {data.outreach.byKind.map((k) => (
                  <li key={k.key} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px] sm:px-6">
                    <span className="text-ink">{k.label}</span>
                    <span className="flex items-center gap-3">
                      <span className="tabular-nums text-ink">{k.value.toLocaleString()}</span>
                      <span className={`w-14 text-right text-[12px] tabular-nums ${k.direction === "up" ? "text-success-ink" : k.direction === "down" ? "text-data-negative" : "text-ink-muted"}`}>
                        {k.change > 0 ? "+" : ""}
                        {k.change}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card padded={false}>
            <CardHeader title="Who did the most outreach?" description={PERIOD_LABEL[data.period]} />
            <CardBody>
              <Shares rows={data.outreach.byPerson} empty="No outreach logged in this period." />
            </CardBody>
          </Card>
        </div>
      </Section>

      <Section title="Revenue" description="Money received and owed, in the organization's currency." action={<Link href="/finance" className="text-[13px] font-medium text-brand hover:underline">Finance</Link>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Invoiced" value={money(data.revenue.invoiced.value)} d={data.revenue.invoiced} money={money} />
          <Kpi label="MRR" value={money(data.revenue.mrrMinor)} hint="Active recurring services" />
          <Kpi label="Outstanding" value={money(data.revenue.outstandingMinor)} hint="Sent and not yet paid, today" />
          <Kpi label="Overdue" value={money(data.revenue.overdueMinor)} hint="Past their due date, today" />
        </div>
        <Card padded={false}>
          <CardHeader title="When did the money come in?" description={`Payments received · ${PERIOD_LABEL[data.period].toLowerCase()}`} />
          <CardBody>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.revenue.trend} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid stroke={CHART.line} vertical={false} />
                  <XAxis dataKey="bucket" tickFormatter={tick} {...AXIS} minTickGap={16} />
                  <YAxis tickFormatter={(v: number) => money(v)} width={72} {...AXIS} />
                  <Tooltip cursor={CURSOR} contentStyle={TOOLTIP} labelFormatter={(l) => tick(String(l))} formatter={(v) => formatMoney(Number(v), data.revenue.currency)} />
                  <Bar dataKey="value" name="Received" fill={CHART.data1} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </Section>

      <Section title="Projects & team" description="Delivery, and the people doing it." action={<Link href="/analytics" className="text-[13px] font-medium text-brand hover:underline">All analytics</Link>}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Active projects" value={String(data.projects.active)} hint={`${data.projects.delayed} delayed`} />
          <Kpi label="Milestones on time" value={pct(data.projects.milestonesOnTime.available ? data.projects.milestonesOnTime.value : null)} d={data.projects.milestonesOnTime} points />
          <Kpi label="Tasks on time" value={pct(data.team.onTimeRate.available ? data.team.onTimeRate.value : null)} d={data.team.onTimeRate} points />
          <Kpi label="Attendance" value={pct(data.team.attendance.available ? data.team.attendance.value : null)} d={data.team.attendance} points hint={`${data.team.attendance.month}`} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card padded={false}>
            <CardHeader title="Who delivered the most?" description={`Tasks completed · ${data.team.overdueNow} overdue across the team now`} />
            <CardBody>
              {data.team.top.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No tasks completed in this period.</p>
              ) : (
                <ul className="space-y-3">
                  {data.team.top.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 text-[13px]">
                      <Avatar name={p.name} color={p.avatarColor} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                      <span className="tabular-nums text-ink">{p.completed}</span>
                      <span className="w-20 text-right text-[12px] tabular-nums text-ink-muted">{p.onTimeRate === null ? "—" : `${Math.round(p.onTimeRate * 100)}% on time`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <AnnouncementsPanel />
        </div>
      </Section>

      <p className="text-[12px] text-ink-muted">
        {data.cached ? "Figures from" : "Computed"} {new Date(data.computedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} · refreshed every five minutes.
      </p>
    </div>
  );
}
