"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Bot,
  Briefcase,
  CheckSquare,
  CornerDownLeft,
  KanbanSquare,
  Layers,
  Plus,
  Receipt,
  Search,
  Users2,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/components/ui/useFocusTrap";

/** A place to go or a thing to start — built by the shell from the role's own navigation. */
export type PaletteCommand = { id: string; label: string; href: string; kind: "go" | "new" };

type Result = {
  kind: "lead" | "client" | "project" | "milestone" | "member" | "agent" | "task" | "invoice";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

type Row = { key: string; title: string; subtitle?: string; href: string; icon: LucideIcon; group: string };

const ICONS: Record<Result["kind"], LucideIcon> = {
  lead: Wallet,
  client: Briefcase,
  project: Layers,
  milestone: KanbanSquare,
  member: Users2,
  agent: Bot,
  task: CheckSquare,
  invoice: Receipt,
};

const GROUP_LABEL: Record<Result["kind"], string> = {
  lead: "Pipeline",
  client: "Clients",
  project: "Projects",
  task: "Tasks",
  milestone: "Milestones",
  invoice: "Invoices",
  member: "Team",
  agent: "AI employees",
};
const ORDER: Result["kind"][] = ["lead", "client", "project", "task", "milestone", "invoice", "member", "agent"];

/**
 * ⌘K: go anywhere, start anything, find any record the viewer may see.
 *
 * Commands come from the shell (the same role-filtered navigation the rail
 * shows); records come from /api/search, scoped server-side — a member's
 * palette simply has less in it. Keyboard: ↑↓ to move, ⏎ to open, esc to
 * close; the input is an ARIA combobox over one listbox.
 */
export function CommandPalette({
  commands = [],
  compact = false,
}: {
  commands?: readonly PaletteCommand[];
  /** The phone top bar's icon trigger. It doesn't own ⌘K — the desktop instance does. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [highlight, setHighlight] = useState(0);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useFocusTrap(open, panelRef, inputRef);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!compact && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [compact]);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setResults([]);
    setStatus("idle");
    setHighlight(0);
  }, [open]);

  // Debounced: typing "milestone" shouldn't fire nine queries.
  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }
    setStatus("loading");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (!response.ok) throw new Error(String(response.status));
        setResults(((await response.json()) as { results: Result[] }).results);
        setStatus("idle");
      } catch {
        // Stale results would answer a question nobody asked any more.
        setResults([]);
        setStatus("error");
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [query]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matching = commands.filter((c) => !q || c.label.toLowerCase().includes(q));
    const commandRows: Row[] = matching.slice(0, q ? 6 : 12).map((c) => ({ key: `cmd-${c.id}`, title: c.label, href: c.href, icon: c.kind === "new" ? Plus : ArrowRight, group: c.kind === "new" ? "Start" : "Go to" }));
    const recordRows: Row[] = ORDER.flatMap((kind) => results.filter((r) => r.kind === kind).map((r) => ({ key: `${r.kind}-${r.id}`, title: r.title, subtitle: r.subtitle, href: r.href, icon: ICONS[r.kind], group: GROUP_LABEL[kind] })));
    return [...commandRows, ...recordRows];
  }, [commands, query, results]);

  useEffect(() => setHighlight(0), [rows.length]);

  const go = useCallback(
    (row: Row) => {
      setOpen(false);
      router.push(row.href);
    },
    [router],
  );

  if (!mounted) return null;

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const groups = rows.reduce<{ label: string; items: { row: Row; index: number }[] }[]>((acc, row, index) => {
    const last = acc[acc.length - 1];
    if (last && last.label === row.group) last.items.push({ row, index });
    else acc.push({ label: row.group, items: [{ row, index }] });
    return acc;
  }, []);
  const searching = query.trim().length >= 2;

  return (
    <>
      {compact ? (
        <button type="button" onClick={() => setOpen(true)} aria-label="Search or jump to a page" className="rounded-[10px] border border-line p-2 text-ink-2 transition-colors hover:bg-surface-2">
          <Search className="h-4 w-4" aria-hidden />
        </button>
      ) : (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2 text-[13px] text-ink-muted transition-colors hover:border-ink/25 hover:text-ink-2 sm:flex"
      >
        <Search className="h-3.5 w-3.5" aria-hidden />
        Search or jump to…
        <kbd className="ml-2 rounded border border-line bg-surface-2 px-1.5 py-0.5 font-sans text-[10px] font-medium text-ink-muted">⌘K</kbd>
      </button>
      )}

      {open &&
        createPortal(
          <div className="no-print fixed inset-0 z-[70] flex items-start justify-center px-4 pt-[12vh]">
            <button type="button" aria-label="Close search" tabIndex={-1} onClick={() => setOpen(false)} className="absolute inset-0 h-full w-full cursor-default bg-green-950/40 animate-fade-in backdrop-blur-[2px]" />

            <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Search and go to" className="relative w-full max-w-lg animate-scale-in overflow-hidden rounded-card border border-line bg-surface">
              <div className="flex items-center gap-3 border-b border-line px-4">
                <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
                <input
                  ref={inputRef}
                  role="combobox"
                  aria-label="Search records or type a page name"
                  aria-expanded={rows.length > 0}
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={rows[highlight] ? optionId(highlight) : undefined}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setHighlight((value) => (value + 1) % Math.max(rows.length, 1));
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setHighlight((value) => (value - 1 + rows.length) % Math.max(rows.length, 1));
                    }
                    if (event.key === "Enter" && rows[highlight]) {
                      event.preventDefault();
                      go(rows[highlight]);
                    }
                  }}
                  placeholder="Leads, clients, projects, tasks, people — or a page"
                  className="w-full bg-transparent py-4 text-sm text-ink placeholder:text-ink-muted focus:outline-none"
                />
              </div>

              <div id={listId} role="listbox" aria-label="Results" className="scrollbar-thin max-h-[52vh] overflow-y-auto">
                {groups.map((group) => (
                  <div key={group.label} role="group" aria-label={group.label}>
                    <p className="eyebrow px-4 pb-1 pt-3 text-ink-muted" aria-hidden>
                      {group.label}
                    </p>
                    {group.items.map(({ row, index }) => {
                      const Icon = row.icon;
                      return (
                        <div
                          key={row.key}
                          id={optionId(index)}
                          role="option"
                          aria-selected={index === highlight}
                          onMouseEnter={() => setHighlight(index)}
                          onClick={() => go(row)}
                          className={cn("flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors", index === highlight ? "bg-surface-2" : "hover:bg-surface-2/60")}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-line bg-surface text-ink-muted" aria-hidden>
                            <Icon className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-ink">{row.title}</span>
                            {row.subtitle && <span className="block truncate text-[12px] text-ink-muted">{row.subtitle}</span>}
                          </span>
                          {index === highlight && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden />}
                        </div>
                      );
                    })}
                  </div>
                ))}
                <p className="px-4 py-6 text-center text-[13px] text-ink-muted" role="status">
                  {status === "error"
                    ? "Search isn't answering right now — try again in a moment."
                    : searching && status === "loading" && results.length === 0
                      ? "Searching…"
                      : searching && results.length === 0 && rows.length === 0
                        ? `Nothing matches “${query.trim()}”.`
                        : !searching && rows.length === 0
                          ? "Type at least two characters to search records."
                          : ""}
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-line bg-surface-2/60 px-4 py-2 text-[11px] text-ink-muted">
                <span>↑↓ to move · ⏎ to open</span>
                <span>esc to close</span>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
