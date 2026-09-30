import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StatTone = "neutral" | "success" | "warning" | "danger" | "info";

const ICON_TONES: Record<StatTone, string> = {
  neutral: "bg-surface-2 text-ink-muted border-line",
  success: "bg-brand-tint text-brand border-brand/15",
  warning: "bg-warn-tint text-warn border-warn/15",
  danger: "bg-danger-tint text-danger-ink border-danger/15",
  info: "bg-info-tint text-info border-info/15",
};

export interface StatCardProps {
  label: string;
  value: string | number;
  /** Small unit rendered next to the value, e.g. "%" or "pts". */
  unit?: string;
  /** A short line under the figure. Takes a node so a trend arrow can live here. */
  hint?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: StatTone;
  /** Renders a shimmer placeholder in place of the value. */
  loading?: boolean;
  /**
   * `hero` fills the tile with the brand green (white text) — the view's one
   * headline figure. At most ONE hero tile per view (CLAUDE.md §7).
   */
  variant?: "default" | "hero";
  className?: string;
}

/** Dashboard metric tile — eyebrow label, oversized Syne figure, one-line hint. */
export function StatCard({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  tone = "neutral",
  loading = false,
  variant = "default",
  className,
}: StatCardProps) {
  const hero = variant === "hero";
  return (
    <div
      className={cn(
        "rounded-card border p-5 transition-colors",
        hero ? "border-brand bg-brand text-on-brand" : "border-line bg-surface hover:border-brand/25",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className={cn("eyebrow pt-1", hero ? "text-on-brand/80" : "text-ink-muted")}>{label}</p>
        {Icon && (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border",
              hero ? "border-on-brand/20 bg-on-brand/10 text-on-brand" : ICON_TONES[tone],
            )}
          >
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>

      <div className="mt-5 flex items-baseline gap-1.5">
        {loading ? (
          <span className="relative block h-9 w-20 overflow-hidden rounded-md bg-surface-2">
            <span className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/70 to-transparent" />
          </span>
        ) : (
          <>
            <span className={cn("font-display text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums", hero ? "text-on-brand" : "text-ink")}>
              {value}
            </span>
            {unit && (
              <span className={cn("font-display text-lg font-bold", hero ? "text-on-brand/60" : "text-ink-muted")}>{unit}</span>
            )}
          </>
        )}
      </div>

      {hint && <p className={cn("mt-2.5 text-[13px] leading-snug", hero ? "text-on-brand/80" : "text-ink-muted")}>{hint}</p>}
    </div>
  );
}
