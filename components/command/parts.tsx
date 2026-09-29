"use client";

import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Delta, Granularity } from "@/modules/analytics/domain";

/**
 * A change against the comparison period. Up is brand green, down is gray —
 * never red (CLAUDE.md §7: negative data is gray). `points` shows a rate's
 * change in percentage points.
 */
export function DeltaText({ d, points = false, money, onDark = false }: { d: Delta & { available?: boolean }; points?: boolean; money?: (minor: number) => string; onDark?: boolean }) {
  if (d.available === false) return <span className={cn("text-[12px]", onDark ? "text-on-brand/70" : "text-ink-muted")}>No comparison yet</span>;
  const Icon = d.direction === "up" ? ArrowUpRight : d.direction === "down" ? ArrowDownRight : Minus;
  const change = points
    ? `${d.change > 0 ? "+" : ""}${d.change} pts`
    : d.percent !== null
      ? `${d.change > 0 ? "+" : ""}${d.percent}%`
      : `${d.change > 0 ? "+" : ""}${money ? money(d.change) : d.change.toLocaleString()}`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[12px] font-medium tabular-nums",
        onDark ? "text-on-brand" : d.direction === "up" ? "text-success-ink" : d.direction === "down" ? "text-data-negative" : "text-ink-muted",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {change}
      <span className={cn("font-normal", onDark ? "text-on-brand/70" : "text-ink-muted")}>vs previous</span>
    </span>
  );
}

/** A KPI tile: label, figure, and its change. `hero` is the view's one filled tile. */
export function Kpi({ label, value, d, points, money, hero = false, hint }: { label: string; value: string; d?: Delta & { available?: boolean }; points?: boolean; money?: (minor: number) => string; hero?: boolean; hint?: ReactNode }) {
  return (
    <div className={cn("rounded-card border p-5", hero ? "border-brand bg-brand text-on-brand" : "border-line bg-surface")}>
      <p className={cn("eyebrow", hero ? "text-on-brand/80" : "text-ink-muted")}>{label}</p>
      <p className={cn("mt-3 font-display text-[30px] font-bold leading-none tracking-[-0.03em] tabular-nums", hero ? "text-on-brand" : "text-ink")}>{value}</p>
      <div className="mt-2.5 min-h-[18px]">{d ? <DeltaText d={d} points={points} money={money} onDark={hero} /> : hint ? <span className={cn("text-[12px]", hero ? "text-on-brand/80" : "text-ink-muted")}>{hint}</span> : null}</div>
    </div>
  );
}

export function bucketLabel(bucket: string, g: Granularity): string {
  if (g === "month") return new Date(`${bucket}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  return new Date(`${bucket}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** A labelled share bar list (breakdowns). */
export function Shares({ rows, format = (v) => v.toLocaleString(), empty }: { rows: { key: string; label: string; value: number }[]; format?: (v: number) => string; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="text-[13px] text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate text-ink">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink">{format(r.value)}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-data-track">
            <div className="h-full rounded-pill bg-data-1" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Section({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
