"use client";

import { EmptyState } from "@/components/ui/EmptyState";
import { TASK_STATUS_LABEL, normalizeTaskStatus } from "@/modules/tasks/domain";

export type FeedEntry = {
  id: string;
  action: string;
  entityType: string;
  summary: string;
  actorName: string | null;
  actorType: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
};

const time = (iso: unknown) =>
  typeof iso === "string"
    ? new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso))
    : "";

/**
 * One audit entry in words a person reads — the activity feed is sourced from
 * the audit log (Phase 2 scope 7), but nobody should have to read JSON.
 * Entries this does not have a sentence for fall back to the log's own
 * summary rather than disappearing.
 */
export function describe(entry: FeedEntry): string {
  const a = entry.after ?? {};
  const b = entry.before ?? {};
  switch (entry.entityType) {
    case "AttendanceDay":
      if ("clockOutAt" in a && a.clockOutAt) return `Clocked out at ${time(a.clockOutAt)}`;
      if ("clockInAt" in a && a.clockInAt) return `Clocked in at ${time(a.clockInAt)}`;
      break;
    case "BreakSession":
      if (entry.action === "RECORD_CREATED") return `Started a break at ${time(a.startedAt)}`;
      if (a.endedAt) return `Back from a break at ${time(a.endedAt)}`;
      break;
    case "Task":
      if (entry.action === "RECORD_CREATED") return `Task created: ${String(a.title ?? "")}`;
      if (entry.action === "RECORD_DELETED") return `Task deleted: ${String(b.title ?? "")}`;
      if ("status" in a) {
        return `Task status: ${TASK_STATUS_LABEL[normalizeTaskStatus(b.status)]} → ${TASK_STATUS_LABEL[normalizeTaskStatus(a.status)]}`;
      }
      if ("assigneeId" in a) return "Task reassigned";
      if ("dueAt" in a) return "Task due date changed";
      return "Task edited";
    case "TaskChecklistItem":
      if (entry.action === "RECORD_CREATED") return `Checklist item added: ${String(a.label ?? "")}`;
      if ("done" in a) return a.done ? "Checked off a checklist item" : "Unchecked a checklist item";
      break;
    case "TaskComment":
      if (entry.action === "RECORD_CREATED") return "Commented on a task";
      break;
    case "File":
      if (entry.action === "RECORD_CREATED") return `Attached ${String(a.filename ?? "a file")}`;
      if (entry.action === "RECORD_DELETED") return `Removed ${String(b.filename ?? "a file")}`;
      break;
    case "UserSkill":
      return entry.action === "RECORD_DELETED" ? "A skill was removed" : `Skill proficiency set to ${String(a.proficiency ?? "")}/5`;
    case "WorkSchedule":
      return "Working schedule updated";
    case "User":
      if ("employmentStatus" in a) return `Status changed to ${String(a.employmentStatus).toLowerCase().replace("_", " ")}`;
      return "Profile updated";
  }
  return entry.summary;
}

export function ActivityFeed({ entries }: { entries: FeedEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface">
        <EmptyState title="Nothing yet" description="Clock-ins, task changes and profile updates appear here as they happen." />
      </div>
    );
  }
  return (
    <ol className="space-y-3">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-3">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/30" aria-hidden />
          <div className="min-w-0">
            <p className="text-[13px] text-ink/85">{describe(e)}</p>
            <p className="text-[11px] tabular-nums text-ink-muted">
              {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(e.createdAt))}
              {e.actorName && ` · ${e.actorName}`}
              {e.actorType === "AI" && " (AI)"}
              {e.actorType === "SYSTEM" && " · automatic"}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
