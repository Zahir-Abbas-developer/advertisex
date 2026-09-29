import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** `inset` for sunken panels, `dark` for deep green hero blocks (one per view). */
  surface?: "card" | "inset" | "dark";
  padded?: boolean;
}

/** 1px-bordered surface. Shadows are deliberately avoided across the product. */
export function Card({
  children,
  className,
  surface = "card",
  padded = true,
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card border",
        surface === "card" && "border-line bg-surface",
        surface === "inset" && "border-line bg-surface-2",
        surface === "dark" && "surface-dark overflow-hidden border-line-strong",
        padded && "p-5 sm:p-6",
        className,
      )}
    >
      {surface === "dark" ? <div className="relative">{children}</div> : children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
  as: Heading = "h2",
}: {
  /** Heading level; h2 under a page's h1 by default (WCAG 1.3.1). */
  as?: "h2" | "h3";
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6",
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="font-display text-base font-bold tracking-tight text-ink-heading">
          {title}
        </Heading>
        {description && (
          <p className="mt-1 text-sm text-ink-muted">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 py-5 sm:px-6", className)}>{children}</div>;
}
