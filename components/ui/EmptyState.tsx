import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

export interface EmptyStateProps {
  /** Any lucide icon component. */
  icon?: ComponentType<{ className?: string }>;
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "neutral" | "danger";
  className?: string;
  /** Heading level: h2 under a page's h1 (the usual place); h3 inside a titled card. */
  headingLevel?: 2 | 3;
}

/**
 * The empty state is a designed screen, never a blank panel — soft medallion,
 * eyebrow, Syne title, one line of guidance and a way forward.
 */
export function EmptyState({
  icon: Icon = Inbox,
  eyebrow,
  title,
  description,
  action,
  tone = "neutral",
  className,
  headingLevel = 2,
}: EmptyStateProps) {
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const danger = tone === "danger";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-16 text-center",
        className,
      )}
    >
      <div
        className={cn(
          "mb-5 flex h-14 w-14 items-center justify-center rounded-card border",
          danger ? "border-danger/20 bg-danger-tint" : "border-line bg-surface-2",
        )}
      >
        <Icon className={cn("h-6 w-6", danger ? "text-danger-ink" : "text-brand")} />
      </div>

      {eyebrow && (
        <p className={cn("eyebrow mb-2", danger ? "text-danger-ink" : "text-brand")}>
          {eyebrow}
        </p>
      )}

      <Heading className="font-display text-lg font-bold tracking-tight text-ink">
        {title}
      </Heading>

      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-muted">
          {description}
        </p>
      )}

      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Error counterpart to EmptyState, with a retry affordance. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this data. Check your connection and try again.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      icon={AlertTriangle}
      tone="danger"
      eyebrow="Error"
      title={title}
      description={description}
      className={className}
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * The small version of ErrorState, for a panel inside a page (a timeline, a
 * drawer tab): one line and a retry, so a failed load is never mistaken for
 * "nothing here".
 */
export function InlineError({ message = "This didn't load.", onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <p role="alert" className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-ink-2">
      {message}
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-medium text-brand underline-offset-2 hover:underline">
          Try again
        </button>
      )}
    </p>
  );
}
