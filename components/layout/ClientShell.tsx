"use client";

import type { ReactNode } from "react";
import { signOut } from "next-auth/react";
import { ChevronDown, LogOut } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Dropdown } from "@/components/ui/Dropdown";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { cn } from "@/lib/utils";

/**
 * The client portal's frame — the third experience (CLAUDE.md §7: "clean,
 * simplified, reassuring, zero internal jargon").
 *
 * A slim top bar instead of the staff rail: a restaurant owner has a handful
 * of places to go, not a command center. Sections that arrive in later phases
 * are shown, labelled "Soon", and not linked — a link to an empty page reads
 * as broken; a quiet label reads as a promise.
 */

const SECTIONS = [
  { label: "Overview", ready: true },
  { label: "Projects", ready: false },
  { label: "Reports", ready: false },
  { label: "Invoices", ready: false },
  { label: "Messages", ready: false },
] as const;

export function ClientShell({
  user,
  accountName,
  children,
}: {
  user: { name: string; avatarColor: string };
  accountName: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-brand font-display text-sm font-bold text-canvas">
              A
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {accountName}
              </p>
              <p className="text-[11px] text-ink/45">with Advertise X</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell reportsHref={null} />
            <Dropdown
              trigger={
                <span className="flex items-center gap-2 rounded-[10px] border border-line px-2 py-1.5 transition-colors hover:bg-surface-2">
                  <Avatar name={user.name} color={user.avatarColor} size="sm" />
                  <span className="hidden text-[13px] text-ink/80 sm:inline">{user.name}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-ink/40" />
                </span>
              }
              items={[
                {
                  key: "sign-out",
                  label: "Sign out",
                  icon: <LogOut />,
                  onSelect: () => void signOut({ callbackUrl: "/login" }),
                },
              ]}
            />
          </div>
        </div>

        <nav
          aria-label="Portal"
          className="scrollbar-thin mx-auto flex max-w-[1200px] gap-1 overflow-x-auto px-4 sm:px-8"
        >
          {SECTIONS.map((section) => (
            <span
              key={section.label}
              aria-current={section.label === "Overview" ? "page" : undefined}
              aria-disabled={!section.ready || undefined}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px]",
                section.label === "Overview"
                  ? "border-brand font-medium text-ink"
                  : "border-transparent text-ink/40",
              )}
            >
              {section.label}
              {!section.ready && (
                <span className="rounded-pill border border-line px-1.5 text-[10px] uppercase tracking-wider text-ink/35">
                  Soon
                </span>
              )}
            </span>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">{children}</main>
    </div>
  );
}
