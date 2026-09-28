"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { AXIS, CHART, CURSOR, TOOLTIP } from "@/components/charts/theme";
import { formatMoney } from "@/lib/pipeline-types";

type Analytics = {
  totals: {
    total: number;
    new: number;
    contacted: number;
    qualified: number;
    followUps: number;
    meetingsBooked: number;
    converted: number;
    lost: number;
    conversionRate: number | null;
    pipelineValue: number;
    openLeads: number;
  };
  bySource: { source: string; label: string; created: number; converted: number }[];
  funnel: { stage: string; label: string; entered: number }[];
  velocity: { stage: string; label: string; avgDays: number; samples: number }[];
  trend: { week: string; created: number; won: number }[];
};

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Every chart answers one question, and its title is that question (§7). */
function ChartCard({ question, detail, children, empty }: { question: string; detail: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <Card>
      <h3 className="font-display text-base font-semibold tracking-[-0.01em] text-ink">{question}</h3>
      <p className="mt-0.5 text-[13px] text-ink-muted">{detail}</p>
      <div className="mt-5 h-64">
        {empty ? <div className="flex h-full items-center justify-center text-[13px] text-ink/35">Not enough data yet</div> : children}
      </div>
    </Card>
  );
}

export function LeadsAnalytics() {
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 90 * 86_400_000)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [data, setData] = useState<Analytics | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    const res = await fetch(`/api/leads/analytics?from=${from}&to=${to}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const range = (
    <div className="flex flex-wrap gap-3">
      <div className="w-44"><Input label="From" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></div>
      <div className="w-44"><Input label="To" type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></div>
    </div>
  );

  if (failed) return <ErrorState title="Analytics didn't load" description="Try again in a moment." onRetry={() => void load()} />;
  if (!data) {
    return (
      <div className="space-y-6">
        {range}
        <Skeleton className="h-[140px] rounded-card" />
        <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-[320px] rounded-card" /><Skeleton className="h-[320px] rounded-card" /></div>
      </div>
    );
  }

  const t = data.totals;
  if (t.total === 0) {
    return (
      <div className="space-y-6">
        {range}
        <Card padded={false}>
          <EmptyState title="No leads yet" description="Add or import leads and this page fills in on its own." />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {range}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard variant="hero" label="New leads" value={t.new.toLocaleString()} hint={`${t.total.toLocaleString()} in total`} />
        <StatCard label="Contacted" value={t.contacted.toLocaleString()} />
        <StatCard label="Qualified" value={t.qualified.toLocaleString()} />
        <StatCard label="Follow-ups" value={t.followUps.toLocaleString()} />
        <StatCard label="Meetings booked" value={t.meetingsBooked.toLocaleString()} />
        <StatCard label="Converted" value={t.converted.toLocaleString()} tone={t.converted > 0 ? "success" : "neutral"} />
        <StatCard label="Lost" value={t.lost.toLocaleString()} />
        <StatCard label="Conversion rate" value={pct(t.conversionRate)} hint="won ÷ (won + lost)" />
        <StatCard label="Pipeline value" value={formatMoney(t.pipelineValue, true)} hint={`${t.openLeads.toLocaleString()} open deals`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard question="Are we adding leads faster than we're winning them?" detail="New leads and deals won, per week" empty={data.trend.every((w) => !w.created && !w.won)}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data.trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={CHART.line} vertical={false} />
              <XAxis dataKey="week" {...AXIS} tickFormatter={(w: string) => w.slice(5)} />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP} cursor={CURSOR} labelFormatter={(w) => `Week of ${w}`} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar dataKey="created" name="New leads" fill={CHART.data2} radius={[3, 3, 0, 0]} />
              <Line dataKey="won" name="Won" stroke={CHART.data1} strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard question="Where do our leads come from?" detail="Leads created and converted, by source" empty={data.bySource.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.bySource} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 24 }}>
              <CartesianGrid stroke={CHART.line} horizontal={false} />
              <XAxis type="number" {...AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="label" {...AXIS} width={110} />
              <Tooltip contentStyle={TOOLTIP} cursor={CURSOR} />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Bar dataKey="created" name="Created" fill={CHART.data2} radius={[0, 3, 3, 0]} />
              <Bar dataKey="converted" name="Converted" fill={CHART.data1} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard question="Where do deals drop off?" detail="Leads that entered each stage in the period" empty={data.funnel.every((f) => !f.entered)}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.funnel} layout="vertical" margin={{ top: 4, right: 12, bottom: 0, left: 24 }}>
              <CartesianGrid stroke={CHART.line} horizontal={false} />
              <XAxis type="number" {...AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="label" {...AXIS} width={100} />
              <Tooltip contentStyle={TOOLTIP} cursor={CURSOR} />
              <Bar dataKey="entered" name="Entered" fill={CHART.data1} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard question="Where do deals wait longest?" detail="Average days a lead stays in each stage before moving on" empty={data.velocity.length === 0}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.velocity} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={CHART.line} vertical={false} />
              <XAxis dataKey="label" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip contentStyle={TOOLTIP} cursor={CURSOR} formatter={(v) => [`${v} days`, "Average stay"]} />
              <Bar dataKey="avgDays" name="Average days" fill={CHART.data2} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
