"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { ChevronDown, LogOut, Settings } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Dropdown } from "@/components/ui/Dropdown";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { cn } from "@/lib/utils";

/**
 * The client portal's frame — the third experience (CLAUDE.md §7: "clean,
 * simplified, reassuring, zero internal jargon").
 *
 * A slim top bar instead of the staff rail: a restaurant owner has a handful
 * of places to go, not a command center. Invoices are the account owner's.
 */

const SECTIONS = [
  { label: "Overview", href: "/portal", exact: true, ownerOnly: false },
  { label: "Projects", href: "/portal/projects", exact: false, ownerOnly: false },
  { label: "Reports", href: "/portal/reports", exact: false, ownerOnly: false },
  { label: "Messages", href: "/portal/messages", exact: false, ownerOnly: false },
  { label: "Invoices", href: "/portal/invoices", exact: false, ownerOnly: true },
  { label: "Settings", href: "/portal/settings", exact: false, ownerOnly: false },
] as const;

export function ClientShell({
  user,
  accountName,
  isOwner,
  children,
}: {
  user: { name: string; avatarColor: string };
  accountName: string;
  isOwner: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-brand font-display text-sm font-bold text-on-brand">
              A
            </span>
            <div className="min-w-0">
              <p className="truncate font-display text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {accountName}
              </p>
              <p className="text-[11px] text-ink-muted">with Advertise X</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell reportsHref="/portal/reports" />
            <Dropdown
              trigger={
                <span className="flex items-center gap-2 rounded-[10px] border border-line px-2 py-1.5 transition-colors hover:bg-surface-2">
                  <Avatar name={user.name} color={user.avatarColor} size="sm" />
                  <span className="hidden text-[13px] text-ink/80 sm:inline">{user.name}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-ink-muted" />
                </span>
              }
              items={[
                {
                  key: "settings",
                  label: "Settings",
                  icon: <Settings />,
                  onSelect: () => {
                    window.location.href = "/portal/settings";
                  },
                },
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
          {SECTIONS.filter((section) => isOwner || !section.ownerOnly).map((section) => {
            const active = section.exact ? pathname === section.href : pathname === section.href || pathname.startsWith(`${section.href}/`);
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px flex shrink-0 items-center border-b-2 px-3 py-2.5 text-[13px] transition-colors",
                  active ? "border-brand font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink",
                )}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-8 sm:py-10">{children}</main>
    </div>
  );
}
