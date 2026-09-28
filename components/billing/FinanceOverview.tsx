"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowDownToLine, Briefcase, CircleDollarSign, Clock3, Handshake, Hourglass, Repeat, UserPlus } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { AXIS, CHART, CURSOR, TOOLTIP } from "@/components/charts/theme";
import { buttonClasses } from "@/components/ui/Button";
import { safeFetch } from "@/lib/safe-fetch";
import { RANGE_LABEL, RANGES, type Range } from "@/modules/billing/domain";
import { formatMoney } from "@/modules/billing/money";
import type { FinancialOverview } from "@/modules/billing/overview";

const monthLabel = (key: string) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short" });

/** A share bar list: each row's part of the whole, largest first. */
function Breakdown({ rows, currency, empty }: { rows: { key: string; name: string; amountMinor: number; href?: string }[]; currency: string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.amountMinor));
  if (rows.length === 0) return <p className="text-[13px] text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-3.5">
      {rows.slice(0, 8).map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            {r.href ? (
              <Link href={r.href} className="truncate text-ink/85 hover:text-brand">
                {r.name}
              </Link>
            ) : (
              <span className="truncate text-ink/85">{r.name}</span>
            )}
            <span className="shrink-0 tabular-nums text-ink">{formatMoney(r.amountMinor, currency, { whole: true })}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-surface-2">
            <div className="h-full rounded-pill" style={{ width: `${(r.amountMinor / max) * 100}%`, background: CHART.data1 }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The founder's money, in one place (Phase 7 scope 3). Every figure comes
 * from /api/finance/overview, whose formulas are in docs/METRICS.md; the
 * breakdowns sum exactly to "Payments received".
 */
export function FinanceOverview() {
  const [range, setRange] = useState<Range>("month");
  const [o, setO] = useState<FinancialOverview | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/finance/overview?range=${range}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setO((await res.json()).overview);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  const money = (minor: number) => formatMoney(minor, o?.currency ?? "USD", { whole: true });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Financial overview"
        description="What came in, what is owed, and what recurs — reconciled to the cent with every invoice and payment."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <Select aria-label="Period" value={range} onChange={(e) => setRange(e.target.value as Range)} options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))} />
            </div>
            <a href={`/api/finance/export?kind=summary&range=${range}`} className={buttonClasses("secondary", "sm")}>
              <ArrowDownToLine className="h-4 w-4" /> Summary CSV
            </a>
            <a href={`/api/finance/export?kind=payments&range=${range}`} className={buttonClasses("ghost", "sm")}>
              Payments CSV
            </a>
            <a href="/api/finance/export?kind=invoices" className={buttonClasses("ghost", "sm")}>
              Invoices CSV
            </a>
          </div>
        }
      />

      {failed ? (
        <ErrorState title="The overview didn't load" onRetry={() => void load()} />
      ) : !o ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-card" />
          ))}
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard variant="hero" label="Payments received" value={money(o.receivedMinor)} icon={CircleDollarSign} tone="success" hint={`${RANGE_LABEL[range]} · ${o.counts.paidInRange} invoice${o.counts.paidInRange === 1 ? "" : "s"}`} />
            <StatCard label="Outstanding" value={money(o.outstandingMinor)} icon={Hourglass} tone="info" hint="Sent and not yet paid, today" />
            <StatCard label="Overdue" value={money(o.overdueMinor)} icon={AlertCircle} tone={o.overdueMinor > 0 ? "danger" : "neutral"} hint={`${o.counts.overdue} invoice${o.counts.overdue === 1 ? "" : "s"} past due`} />
            <StatCard label="MRR" value={money(o.mrrMinor)} icon={Repeat} tone="neutral" hint={`${money(o.arrMinor)} a year, from recurring services`} />
            <StatCard label="Pending" value={money(o.pendingMinor)} icon={Clock3} hint={`${o.counts.pending} invoice${o.counts.pending === 1 ? "" : "s"} not yet due`} />
            <StatCard label="Invoiced" value={money(o.invoicedMinor)} icon={Briefcase} hint={`Issued ${RANGE_LABEL[range].toLowerCase()}`} />
            <StatCard label="New clients" value={o.newClients} icon={UserPlus} hint={RANGE_LABEL[range]} />
            <StatCard label="Closed deals" value={o.closedDeals.count} icon={Handshake} hint={`${money(o.closedDeals.valueMinor)} in deal value`} />
          </section>

          {o.counts.otherCurrency > 0 && (
            <p className="text-[12px] text-ink-muted">
              {o.counts.otherCurrency} invoice{o.counts.otherCurrency === 1 ? " is" : "s are"} in another currency and not included (figures are in {o.currency}, never converted).
            </p>
          )}

          <Card padded={false}>
            <CardHeader title="How much came in each month?" description="Payments received against invoices issued, last 12 months" />
            <CardBody>
              {o.trend.every((t) => t.receivedMinor === 0 && t.invoicedMinor === 0) ? (
                <EmptyState icon={CircleDollarSign} title="No money movement yet" description="Send an invoice and record its payment — the months fill in here." />
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={o.trend} margin={{ left: 0, right: 8, top: 8 }}>
                      <CartesianGrid stroke={CHART.line} vertical={false} />
                      <XAxis dataKey="month" tickFormatter={monthLabel} {...AXIS} />
                      <YAxis tickFormatter={(v: number) => formatMoney(v, o.currency, { whole: true }).replace(/,000$/, "k")} width={72} {...AXIS} />
                      <Tooltip cursor={CURSOR} contentStyle={TOOLTIP} labelFormatter={(l) => monthLabel(String(l))} formatter={(v) => formatMoney(Number(v), o.currency)} />
                      <Legend wrapperStyle={{ fontSize: 12, color: CHART.ink, opacity: 0.7 }} />
                      <Bar dataKey="invoicedMinor" name="Invoiced" fill={CHART.data2} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="receivedMinor" name="Received" fill={CHART.data1} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardBody>
          </Card>

          <section className="grid gap-6 lg:grid-cols-3">
            <Card padded={false}>
              <CardHeader title="Who paid us most?" description={`Revenue by client · ${RANGE_LABEL[range].toLowerCase()}`} />
              <CardBody>
                <Breakdown rows={o.byClient.map((c) => ({ key: c.clientId, name: c.clientName, amountMinor: c.amountMinor, href: `/clients/${c.clientId}` }))} currency={o.currency} empty="No payments in this period." />
              </CardBody>
            </Card>
            <Card padded={false}>
              <CardHeader title="Which services earn the most?" description={`Revenue by service · ${RANGE_LABEL[range].toLowerCase()}`} />
              <CardBody>
                <Breakdown rows={o.byService} currency={o.currency} empty="No payments in this period." />
              </CardBody>
            </Card>
            <Card padded={false}>
              <CardHeader title="Where does MRR come from?" description="Active recurring services, monthly value" />
              <CardBody>
                <Breakdown rows={o.mrrByService.map((s) => ({ key: s.name, ...s }))} currency={o.currency} empty="No recurring services are active." />
              </CardBody>
            </Card>
          </section>

          <p className="text-[12px] text-ink-muted">
            {o.range.from} to {o.range.to}, company calendar. Revenue is money received in the period; pending, overdue and outstanding are balances as of today.
          </p>
        </>
      )}
    </div>
  );
}
