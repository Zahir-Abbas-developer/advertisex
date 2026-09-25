"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Page controls for a list. Position, not page-size choices — every list
 * paginates at a size its screen chose, and a size picker on each one is a
 * setting nobody asked to manage.
 *
 * Renders nothing for a single page: controls that can do nothing are noise.
 */
export function Pagination({
  page,
  pageCount,
  onPageChange,
  className,
}: {
  /** 1-indexed. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (pageCount <= 1) return null;

  const arrow =
    "inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-line text-ink/60 " +
    "transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40";

  return (
    <nav aria-label="Pagination" className={cn("flex items-center gap-3", className)}>
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={arrow}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <span className="text-[13px] tabular-nums text-ink/60">
        Page {page} of {pageCount}
      </span>

      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        className={arrow}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
