"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/components/ui/useFocusTrap";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg";
}

/**
 * Right-side panel. Distinct from Modal on purpose: a modal interrupts to ask
 * one question, a drawer opens a record alongside what you were looking at, so
 * the board behind it stays visible and in place.
 */
export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  width = "lg",
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Focus moves into the panel, stays there, and returns on close.
  useFocusTrap(open, panelRef);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="no-print fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-green-950/40 animate-fade-in backdrop-blur-[2px]"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "absolute inset-y-0 right-0 outline-none flex w-full flex-col border-l border-line bg-surface",
          // Slides in on transform alone. Opacity is never animated here, so
          // the panel cannot end up invisible if the animation is skipped.
          "animate-slide-in-right",
          width === "lg" ? "sm:w-[560px]" : "sm:w-[440px]",
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0">
            {eyebrow && <p className="eyebrow mb-1.5 text-brand">{eyebrow}</p>}
            <h2 id={titleId} className="break-words font-display text-lg font-bold leading-snug tracking-tight text-ink">
              {title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-pill p-2 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="scrollbar-thin flex-1 overflow-y-auto">{children}</div>

        {footer && (
          <div className="border-t border-line bg-surface px-5 py-3.5">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
