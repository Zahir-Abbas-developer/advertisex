"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * A label for the thing under the pointer — nothing more.
 *
 * Deliberately CSS-only: shown on hover and on keyboard focus, gone on blur,
 * no portal, no positioning library. That rules out flipping when the trigger
 * sits at a viewport edge, which is the acceptable cost of a tooltip that can
 * never desynchronise from its trigger. Content is a short string by
 * contract; anything that needs structure belongs in a popover or the page.
 */
export function Tooltip({
  content,
  side = "top",
  children,
  className,
}: {
  content: string;
  side?: "top" | "bottom";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-40 -translate-x-1/2 whitespace-nowrap",
          "rounded-[8px] border border-line-strong bg-surface-2 px-2.5 py-1 text-[12px] text-ink/85",
          "opacity-0 transition-opacity duration-150 ease-out",
          "group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
        )}
      >
        {content}
      </span>
    </span>
  );
}
