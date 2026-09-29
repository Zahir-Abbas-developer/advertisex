"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Briefcase, CalendarCheck, CircleDollarSign, Gauge, PhoneOutgoing, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { AXIS, CHART, CURSOR, TOOLTIP, chartAnimation } from "@/components/charts/theme";
import { safeFetch } from "@/lib/safe-fetch";
import { formatMoney } from "@/modules/billing/money";
import { PERIOD_LABEL, PERIODS, type Period } from "@/modules/analytics/domain";
import type { receivables as Receivables, retention as Retention } from "@/modules/analytics/server";
import { Kpi } from "@/components/command/parts";

const PAGES = [
  { href: "/finance", icon: CircleDollarSign, title: "Revenue & sales", question: "What came in, what is owed, and what recurs?" },
  { href: "/pipeline/analytics", icon: TrendingUp, title: "Leads & conversion", question: "Where do leads come from, and how many do we win?" },
  { href: "/outreach", icon: PhoneOutgoing, title: "Outreach", question: "How much outreach is the team doing, and by whom?" },
  { href: "/team/performance", icon: Gauge, title: "Team productivity", question: "Who is delivering, on time, and who is overloaded?" },
  { href: "/attendance", icon: CalendarCheck, title: "Attendance", question: "Who is here, on time, and on leave?" },
  { href: "/projects/analytics", icon: Briefcase, title: "Project delivery", question: "Which projects are late, and what is due soon?" },
] as const;

type RetentionData = Awaited<ReturnType<typeof Retention>>;
type ReceivablesData = Awaited<ReturnType<typeof Receivables>>;

/** The internal analytics hub (Phase 8 scope 2): every analytics page in one place, plus retention and receivables. */
export function AnalyticsHub() {
  const [period, setPeriod] = useState<Period>("quarter");
  const [ret, setRet] = useState<RetentionData | null>(null);
  const [rec, setRec] = useState<ReceivablesData | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([safeFetch(`/api/analytics/retention?period=${period}`, { cache: "no-store" }), safeFetch("/api/analytics/receivables", { cache: "no-store" })]);
    if (!a.ok || !b.ok) return setFailed(true);
    setFailed(false);
    setRet((await a.json()).retention);
    setRec((await b.json()).receivables);
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (m: number) => formatMoney(m, rec?.currency ?? "USD", { whole: true });

  return (
    <div className="space-y-10">
      <PageHeader eyebrow="Analytics" title="Every number, one place" description="Each page answers one question. Client retention and outstanding payments are below." />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PAGES.map((p) => (
          <Link key={p.href} href={p.href} className="group rounded-card border border-line bg-surface p-5 transition-colors hover:border-brand/30">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-line bg-surface-2 text-brand">
              <p.icon className="h-4 w-4" />
            </span>
            <p className="mt-4 font-display text-base font-bold text-ink-heading">{p.title}</p>
            <p className="mt-1 text-[13px] text-ink-muted">{p.question}</p>
            <span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-brand">
              Open <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </section>

      {failed ? (
        <ErrorState title="Retention and receivables didn't load" onRetry={() => void load()} />
      ) : !ret || !rec ? (
        <Skeleton className="h-72 rounded-card" />
      ) : (
        <>
          <section className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold tracking-tight text-ink">Client retention</h2>
                <p className="mt-0.5 text-[13px] text-ink-muted">Of the clients we had when the period began, how many are still with us?</p>
              </div>
              <div className="w-48">
                <Select aria-label="Period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} options={PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))} />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi hero label="Retention" value={ret.retentionRate === null ? "—" : `${ret.retentionRate}%`} d={ret.retentionDelta} points />
              <Kpi label="Active clients" value={String(ret.activeNow)} hint={`${ret.activeAtStart} at the start`} />
              <Kpi label="New clients" value={String(ret.added)} d={ret.addedDelta} />
              <Kpi label="Churned" value={String(ret.churned.length)} hint={ret.churned.length ? ret.churned.map((c) => c.name).join(", ") : "None this period"} />
            </div>
          </section>

          <section className="space-y-4">
            <div>
              <h2 className="font-display text-lg font-bold tracking-tight text-ink">Outstanding payments</h2>
              <p className="mt-0.5 text-[13px] text-ink-muted">How much is owed, and how late is it?</p>
            </div>
            <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <Card padded={false}>
                <CardHeader title="How late is what we're owed?" description={`${money(rec.totalMinor)} outstanding today`} />
                <CardBody>
                  <div role="img" aria-label="Chart: How late is what we're owed?" className="h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={rec.buckets} margin={{ left: 0, right: 8, top: 8 }}>
                        <CartesianGrid stroke={CHART.line} vertical={false} />
                        <XAxis dataKey="label" {...AXIS} interval={0} tick={{ ...AXIS.tick, fontSize: 10 }} />
                        <YAxis tickFormatter={(v: number) => money(v)} width={72} {...AXIS} />
                        <Tooltip cursor={CURSOR} contentStyle={TOOLTIP} formatter={(v) => formatMoney(Number(v), rec.currency)} />
                        {/* Lateness is data, so the green scale deepens with age — no red. */}
                        <Bar isAnimationActive={chartAnimation()} dataKey="amountMinor" name="Outstanding" fill={CHART.data4} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardBody>
              </Card>
              <Card padded={false}>
                <CardHeader title="Who owes the most?" description="Open balances by client" />
                <CardBody className="p-0 sm:p-0">
                  {rec.byClient.length === 0 ? (
                    <p className="px-5 py-5 text-[13px] text-ink-muted sm:px-6">Nothing is owed.</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {rec.byClient.slice(0, 8).map((c) => (
                        <li key={c.clientId} className="flex items-center justify-between gap-3 px-5 py-3 text-[13px] sm:px-6">
                          <Link href={`/clients/${c.clientId}`} className="truncate text-ink hover:text-brand">
                            {c.clientName}
                          </Link>
                          <span className="text-right">
                            <span className="block tabular-nums text-ink">{money(c.totalMinor)}</span>
                            {c.lateMinor > 0 && <span className="block text-[12px] tabular-nums text-ink-muted">{money(c.lateMinor)} late</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              </Card>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
