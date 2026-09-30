import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONES: Record<BadgeTone, string> = {
  success: "bg-success-tint text-success-ink border-success/25",
  // Warning text is ink, not orange: #D97706 is 3.2:1 on white. The dot carries the hue.
  warning: "bg-warn-tint text-ink border-warn/25",
  danger: "bg-danger-tint text-danger-ink border-danger/20",
  info: "bg-info-tint text-ink border-info/25",
  neutral: "bg-surface-2 text-ink-2 border-line",
};

const DOTS: Record<BadgeTone, string> = {
  success: "bg-success",
  warning: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-data-neutral",
};

export interface BadgeProps {
  tone?: BadgeTone;
  /** Leading status dot — use for lifecycle states, omit for plain labels. */
  dot?: boolean;
  size?: "sm" | "md";
  className?: string;
  children: ReactNode;
}

/** Rounded pill badge — the standard way statuses are shown across the product. */
export function Badge({
  tone = "neutral",
  dot = false,
  size = "md",
  className,
  children,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span aria-hidden className={cn("h-1.5 w-1.5 rounded-pill", DOTS[tone])} />
      )}
      {children}
    </span>
  );
}
