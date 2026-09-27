import { normalizeTaskStatus, TASK_STATUS_LABEL } from "@/modules/tasks/domain";
import { normalizeProjectStatus, PROJECT_STATUS_LABEL } from "@/modules/projects/domain";

/**
 * A project's activity feed is its audit trail (as the Phase 2 feeds are),
 * rendered as sentences. Pure: the entry and a name lookup in, a sentence (or
 * null for noise) out. Pinned by tests/projects-activity.test.ts.
 */

export type AuditEntryLike = {
  action: string;
  entityType: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

type Names = { user: (id: unknown) => string | null; service: (id: unknown) => string | null };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const day = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
};

export function describeProjectEvent(e: AuditEntryLike, names: Names): string | null {
  const row = e.after ?? e.before ?? {};
  const created = e.action === "RECORD_CREATED";
  const deleted = e.action === "RECORD_DELETED";
  const b = e.before ?? {};

  switch (e.entityType) {
    case "Project": {
      if (created) return "created the project";
      if (deleted) return "deleted the project";
      const a = e.after ?? {};
      if (a.status && a.status !== b.status) return `moved the project to ${PROJECT_STATUS_LABEL[normalizeProjectStatus(a.status)]}`;
      if (a.endDate && b.endDate !== undefined && a.endDate !== b.endDate) return `moved the deadline to ${day(a.endDate)}`;
      if (a.ownerId !== undefined && b.ownerId !== undefined && a.ownerId !== b.ownerId) return `made ${names.user(a.ownerId) ?? "someone"} the owner`;
      if (a.priority && b.priority !== undefined && a.priority !== b.priority) return `set the priority to ${str(a.priority).toLowerCase()}`;
      if (e.before === null) return "updated the project";
      return null;
    }
    case "ProjectStage": {
      const name = str(row.name);
      if (created) return `added the stage ${name}`;
      if (deleted) return `removed the stage ${name}`;
      if (b.name && e.after?.name && b.name !== e.after.name) return `renamed ${str(b.name)} to ${str(e.after.name)}`;
      if (e.after?.status === "DONE" && b.status !== "DONE") return `completed ${name}`;
      if (e.after?.status === "ACTIVE" && b.status !== "ACTIVE") return `started ${name}`;
      return null;
    }
    case "ProjectMilestone": {
      const title = str(row.title);
      if (created) return `added the milestone ${title}`;
      if (deleted) return `removed the milestone ${title}`;
      if (row.status === "DONE" && b.status !== "DONE") return `reached ${title}`;
      if (row.status === "OPEN" && b.status === "DONE") return `reopened ${title}`;
      return `edited the milestone ${title}`;
    }
    case "Task": {
      const title = str(row.title);
      if (created) return `added the task ${title}`;
      if (deleted) return `removed the task ${title}`;
      if (row.status && row.status !== b.status) return `moved ${title} to ${TASK_STATUS_LABEL[normalizeTaskStatus(row.status)]}`;
      return null;
    }
    case "ProjectMember": {
      const who = names.user(row.userId) ?? "someone";
      if (created) return `added ${who} to the team`;
      if (deleted) return `took ${who} off the team`;
      return null;
    }
    case "ProjectService": {
      const what = names.service(row.serviceId) ?? "a service";
      if (created) return `added ${what}`;
      if (deleted) return `removed ${what}`;
      return null;
    }
    case "ProjectComment":
      return created ? "commented" : null;
    case "File":
      if (created) return `uploaded ${str(row.filename)}`;
      if (deleted) return `removed ${str(row.filename)}`;
      if (row.visibility && b.visibility && row.visibility !== b.visibility) {
        return row.visibility === "CLIENT" ? `shared ${str(row.filename)} with the client` : `made ${str(row.filename)} internal`;
      }
      return null;
    default:
      return null;
  }
}
