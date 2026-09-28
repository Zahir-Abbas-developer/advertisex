import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { formatMoney } from "@/lib/pipeline-types";
import { CHART } from "@/components/charts/theme";
import { cn } from "@/lib/utils";

export type MrrPoint = {
  year: number;
  month: number;
  amount: number;
  activeClients: number;
};

/**
 * Monthly recurring revenue — the number the whole machine exists to grow.
 *
 * First card on the owner's dashboard, and the only one with a chart, because
 * MRR is the one figure where the shape of the last six months says more than
 * today's value. The sparkline is hand-drawn SVG rather than a charting
 * library: six points and a fill is not worth 40kB in the bundle, and it
 * inherits the palette instead of fighting a library's defaults.
 */
export function MrrCard({
  current,
  activeClients,
  delta,
  deltaPercent,
  series,
  collected,
  outstanding,
}: {
  current: number;
  activeClients: number;
  delta: number | null;
  deltaPercent: number | null;
  series: MrrPoint[];
  /** This month's retainer value that has actually arrived. */
  collected?: number | null;
  outstanding?: number | null;
}) {
  const up = delta !== null && delta > 0;
  const flat = delta === null || delta === 0;

  return (
    <div className="surface-dark relative overflow-hidden rounded-card border border-line-strong sm:col-span-2">
      <div className="relative p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow text-ink-muted">Monthly recurring revenue</p>
            <p className="mt-3 font-display text-[38px] font-bold leading-none tracking-[-0.03em] tabular-nums text-ink">
              {formatMoney(current)}
            </p>
            <p className="mt-2 text-[13px] text-ink-muted">
              {activeClients} active client{activeClients === 1 ? "" : "s"} on retainer
            </p>

            {/* Agreed and arrived are different numbers, and only one of them
                pays salaries. */}
            {collected !== null && collected !== undefined && (
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                <span className="inline-flex items-center gap-1.5 text-ink">
                  <span className="h-1.5 w-1.5 rounded-full bg-data-2" />
                  {formatMoney(collected, true)} collected
                </span>
                {(outstanding ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1.5 text-ink-muted">
                    <span className="h-1.5 w-1.5 rounded-full bg-data-neutral" />
                    {formatMoney(outstanding ?? 0, true)} outstanding
                  </span>
                )}
              </p>
            )}
          </div>

          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-pill px-2.5 py-1 text-[12px] font-medium tabular-nums",
              flat
                ? "bg-ink/10 text-ink-2"
                : up
                  ? "bg-brand/40 text-ink"
                  : // A fall is data, not an error: gray, never red (CLAUDE.md §7).
                    "bg-data-negative/40 text-ink",
            )}
          >
            {flat ? (
              <Minus className="h-3 w-3" />
            ) : up ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {delta === null
              ? "No history yet"
              : `${up ? "+" : ""}${formatMoney(delta, true)}${
                  deltaPercent !== null ? ` · ${up ? "+" : ""}${deltaPercent}%` : ""
                }`}
          </span>
        </div>

        {series.length > 1 && <Sparkline series={series} />}
      </div>
    </div>
  );
}

/** Six months of MRR as an area chart, in SVG, with no dependencies. */
function Sparkline({ series }: { series: MrrPoint[] }) {
  const width = 320;
  const height = 56;
  const max = Math.max(...series.map((point) => point.amount), 1);
  // A floor of zero rather than the minimum: a chart that starts at the lowest
  // month exaggerates every wobble into a cliff.
  const scaleY = (amount: number) => height - (amount / max) * (height - 6) - 3;
  const scaleX = (index: number) => (index / (series.length - 1)) * width;

  const points = series.map((point, index) => `${scaleX(index)},${scaleY(point.amount)}`);
  const line = `M ${points.join(" L ")}`;
  const area = `${line} L ${width},${height} L 0,${height} Z`;

  return (
    <div className="mt-5">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-14 w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="mrr-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.data2} stopOpacity="0.35" />
            <stop offset="100%" stopColor={CHART.data2} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#mrr-fill)" />
        <path
          d={line}
          fill="none"
          stroke={CHART.data2}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle
          cx={scaleX(series.length - 1)}
          cy={scaleY(series[series.length - 1].amount)}
          r="3"
          fill={CHART.data2}
        />
      </svg>

      <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-ink/30">
        <span>{monthLabel(series[0])}</span>
        <span>{monthLabel(series[series.length - 1])}</span>
      </div>
    </div>
  );
}

function monthLabel(point: MrrPoint): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(point.year, point.month - 1, 1)),
  );
}
