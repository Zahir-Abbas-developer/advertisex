"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/Card";
import { formatMoney } from "@/lib/pipeline-types";
import type { KpiWeekRow } from "@/components/kpis/KpiPanel";
import { AXIS, CHART, CURSOR, TOOLTIP, chartAnimation } from "@/components/charts/theme";

/**
 * Spend against revenue, ROAS against target, and orders.
 *
 * Three charts rather than one with three axes: a dual-axis chart lets you
 * draw any two series as though they move together, which is exactly the
 * misreading a client conversation doesn't need.
 *
 * The palette comes from CLAUDE.md §7 rather than recharts' defaults: series
 * draw down the green scale (the data-* tokens), with a gray dashed target
 * line, so these look like part of the product instead of a library dropped
 * into it.
 */

const DATA_PRIMARY = CHART.data1;
const DATA_SECONDARY = CHART.data4;
const LINE = CHART.line;

export function KpiCharts({
  weeks,
  targetRoas,
}: {
  weeks: KpiWeekRow[];
  targetRoas: number;
}) {
  const data = weeks.map((week) => ({
    week: new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(week.weekStart)),
    spend: week.spend,
    revenue: week.revenue,
    roas: week.roas,
    orders: week.orders,
  }));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <ChartHeading
          title="Spend and revenue"
          description="What went in against what came back, week by week."
        />
        <div role="img" aria-label="Chart: Spend and revenue" className="mt-4 h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis dataKey="week" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={(value) => formatMoney(Number(value), true)} />
              <Tooltip
                cursor={CURSOR}
                contentStyle={TOOLTIP}
                formatter={(value, name) => [formatMoney(Number(value ?? 0)), String(name)]}
              />
              <Legend wrapperStyle={LEGEND} />
              <Bar isAnimationActive={chartAnimation()} dataKey="spend" name="Ad spend" fill={DATA_SECONDARY} radius={[3, 3, 0, 0]} />
              <Bar isAnimationActive={chartAnimation()} dataKey="revenue" name="Revenue" fill={DATA_PRIMARY} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <ChartHeading
          title="ROAS against target"
          description={`The dashed line is this client's target of ${targetRoas}.`}
        />
        <div role="img" aria-label="Chart: ROAS against target" className="mt-4 h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis dataKey="week" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip
                contentStyle={TOOLTIP}
                formatter={(value) => [String(value ?? "—"), "ROAS"]}
              />
              <ReferenceLine
                y={targetRoas}
                stroke={CHART.baseline}
                strokeDasharray="4 4"
                strokeWidth={1.5}
              />
              <Line isAnimationActive={chartAnimation()}
                type="monotone"
                dataKey="roas"
                name="ROAS"
                stroke={DATA_PRIMARY}
                strokeWidth={2}
                // A week with no spend has no ROAS. Connecting across the gap
                // would draw a trend through a week nobody ran ads in.
                connectNulls={false}
                dot={{ r: 3, fill: DATA_PRIMARY, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <ChartHeading title="Orders" description="Volume, independent of basket size." />
        <div role="img" aria-label="Chart: Orders" className="mt-4 h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis dataKey="week" {...AXIS} />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip
                cursor={CURSOR}
                contentStyle={TOOLTIP}
                formatter={(value) => [String(value ?? 0), "Orders"]}
              />
              <Bar isAnimationActive={chartAnimation()} dataKey="orders" name="Orders" fill={DATA_PRIMARY} fillOpacity={0.75} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}



const LEGEND = { fontSize: 12, paddingTop: 8 } as const;

function ChartHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="font-display text-base font-bold tracking-tight text-ink-heading">{title}</h3>
      <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>
    </div>
  );
}
