"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export interface DropdownItem {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Renders in danger tone — destructive actions. */
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

/**
 * A small action menu on a trigger — the "…" next to a row, the account menu
 * in the top bar.
 *
 * Headless and dependency-free: open state, outside-click, Escape and basic
 * arrow-key movement are handled here; the trigger is whatever the caller
 * renders. Items are actions by contract (`onSelect`), never navigation-only
 * content — a list of links is navigation and belongs in the page, where it
 * can be crawled and middle-clicked.
 */
export function Dropdown({
  trigger,
  items,
  align = "end",
  className,
  label,
}: {
  trigger: ReactNode;
  /** The trigger's accessible name, when its content doesn't say it (an avatar, an icon). */
  label?: string;
  items: readonly DropdownItem[];
  align?: "start" | "end";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Opening puts focus on the first item, as a menu should.
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus(); // back to where the menu came from
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const options = rootRef.current?.querySelectorAll<HTMLButtonElement>(
          "[role='menuitem']:not(:disabled)",
        );
        if (!options?.length) return;
        const current = [...options].indexOf(document.activeElement as HTMLButtonElement);
        const next =
          event.key === "ArrowDown"
            ? options[(current + 1) % options.length]
            : options[(current - 1 + options.length) % options.length];
        next.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex rounded-[8px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        {trigger}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          className={cn(
            "absolute top-full z-40 mt-1.5 min-w-44 overflow-hidden rounded-[12px]",
            "border border-line-strong bg-surface-2 py-1 shadow-none",
            align === "end" ? "right-0" : "left-0",
          )}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                item.onSelect();
              }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-[13px] transition-colors",
                item.danger
                  ? "text-danger hover:bg-danger-tint"
                  : "text-ink/80 hover:bg-brand-tint hover:text-ink",
                "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
              )}
            >
              {item.icon && <span className="text-ink-muted [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
