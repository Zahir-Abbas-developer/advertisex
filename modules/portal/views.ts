/**
 * What a client may see — allow-lists, not deny-lists (Phase 6 scope 3).
 *
 * Every object the portal renders is built here from named fields. A field
 * added to a model later is invisible to clients until someone adds it to a
 * view on purpose, so "internal notes never leak" doesn't depend on
 * remembering to hide things. Pure; pinned by tests/portal-views.test.ts.
 */

import { resolvePreferences } from "@/modules/notifications/catalog";

export const CLIENT_VISIBLE = "CLIENT";

/** Plain-language project states for a restaurant owner — no internal jargon. */
export const CLIENT_STATUS_TEXT: Record<string, string> = {
  PLANNING: "Getting started",
  ACTIVE: "In progress",
  ON_HOLD: "Paused",
  COMPLETED: "Completed",
  CANCELLED: "Stopped",
  OVERDUE_CLOSEOUT: "Completed",
};

export type PortalStage = { name: string; state: "done" | "current" | "upcoming" };
export type PortalMilestone = { title: string; dueDate: string | null; done: boolean; completedAt: string | null };
export type PortalUpdate = { id: string; title: string; body: string; author: string | null; createdAt: string };

export type PortalProject = {
  id: string;
  title: string;
  status: string;
  statusText: string;
  progress: number;
  startDate: string;
  deadline: string;
  services: string[];
  stages: { service: string | null; stages: PortalStage[] }[];
  completedMilestones: PortalMilestone[];
  upcomingMilestones: PortalMilestone[];
  updates: PortalUpdate[];
};

type StageRow = { name: string; order: number; status: string; serviceId: string | null };
type MilestoneRow = { title: string; dueDate: Date | null; status: string; completedAt: Date | null; description?: unknown; assigneeId?: unknown };
type UpdateRow = { id: string; title: string; body: string; visibility: string; createdAt: Date; author?: { name: string } | null };

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Stage lines, each stage as done / current (the first unfinished) / upcoming. */
export function stageTracker(stages: readonly StageRow[], serviceNames: ReadonlyMap<string, string>): PortalProject["stages"] {
  const lines = new Map<string, StageRow[]>();
  for (const s of stages) lines.set(s.serviceId ?? "", [...(lines.get(s.serviceId ?? "") ?? []), s]);
  return [...lines.entries()].map(([serviceId, rows]) => {
    const sorted = [...rows].sort((a, b) => a.order - b.order);
    const current = sorted.find((s) => s.status !== "DONE");
    return {
      service: serviceId ? serviceNames.get(serviceId) ?? null : null,
      stages: sorted.map((s) => ({ name: s.name, state: s.status === "DONE" ? "done" : s === current ? "current" : "upcoming" })),
    };
  });
}

/** Milestones as titles and dates only — never descriptions or owners. */
export function milestoneView(m: MilestoneRow): PortalMilestone {
  return { title: m.title, dueDate: day(m.dueDate), done: m.status === "DONE", completedAt: m.completedAt ? m.completedAt.toISOString() : null };
}

/** Only updates the team marked for the client. */
export function clientUpdates(rows: readonly UpdateRow[]): PortalUpdate[] {
  return rows
    .filter((u) => u.visibility === CLIENT_VISIBLE)
    .map((u) => ({ id: u.id, title: u.title, body: u.body, author: u.author?.name ?? null, createdAt: u.createdAt.toISOString() }));
}

export function projectView(input: {
  project: { id: string; title: string; status: string; startDate: Date; endDate: Date };
  progress: number;
  services: readonly { id: string; name: string }[];
  stages: readonly StageRow[];
  milestones: readonly MilestoneRow[];
  updates: readonly UpdateRow[];
  now: Date;
}): PortalProject {
  const names = new Map(input.services.map((s) => [s.id, s.name]));
  const ms = input.milestones.map(milestoneView);
  return {
    id: input.project.id,
    title: input.project.title,
    status: input.project.status,
    statusText: CLIENT_STATUS_TEXT[input.project.status] ?? "In progress",
    progress: input.progress,
    startDate: day(input.project.startDate)!,
    deadline: day(input.project.endDate)!,
    services: input.services.map((s) => s.name),
    stages: stageTracker(input.stages, names),
    completedMilestones: ms.filter((m) => m.done).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
    upcomingMilestones: ms.filter((m) => !m.done).sort((a, b) => (a.dueDate ?? "9").localeCompare(b.dueDate ?? "9")),
    updates: clientUpdates(input.updates).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export const REPORT_KINDS = ["MONTHLY", "WEEKLY", "CAMPAIGN", "AUDIT", "OTHER"] as const;
export const REPORT_KIND_LABEL: Record<(typeof REPORT_KINDS)[number], string> = {
  MONTHLY: "Monthly report",
  WEEKLY: "Weekly report",
  CAMPAIGN: "Campaign report",
  AUDIT: "Audit",
  OTHER: "Report",
};

/** "Monthly Report — January 2026" style month label for "2026-01". */
export function monthLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return period;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Reports grouped by month, newest month first. */
export function groupReports<T extends { periodMonth: string }>(reports: readonly T[]): { month: string; label: string; reports: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of reports) map.set(r.periodMonth, [...(map.get(r.periodMonth) ?? []), r]);
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, rs]) => ({ month, label: monthLabel(month), reports: rs }));
}

/**
 * The Phase 6 portal view of notification preferences (on/off per kind). Since
 * Phase 8 the stored form is the full catalog (modules/notifications/catalog.ts);
 * this reads it, so the portal's older settings API keeps working.
 */
export const NOTIFICATION_KINDS = ["messages", "reports", "updates"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];
export function parsePrefs(json: string | null | undefined): Record<NotificationKind, boolean> {
  const { levels } = resolvePreferences(json);
  return { messages: levels.messages !== "off", reports: levels.reports !== "off", updates: levels.updates !== "off" };
}
