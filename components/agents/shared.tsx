import { Badge, type BadgeTone } from "@/components/ui/Badge";

/** Copy and small pieces shared by the AI-employee screens (client-safe: no server imports). */

export const RUN_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  QUEUED: { label: "Queued", tone: "neutral" },
  RUNNING: { label: "Working", tone: "info" },
  AWAITING_APPROVAL: { label: "Awaiting approval", tone: "warning" },
  DONE: { label: "Done", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export function RunStatusBadge({ status }: { status: string }) {
  const s = RUN_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={s.tone} dot size="sm">
      {s.label}
    </Badge>
  );
}

export const APPROVAL_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  PENDING: { label: "Waiting", tone: "warning" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "neutral" },
  FAILED: { label: "Approved · couldn't be done", tone: "danger" },
};

export const APPROVAL_KIND_LABEL: Record<string, string> = {
  SEND_CLIENT_MESSAGE: "Send a message to a client",
  LEAD_OUTCOME: "Mark a lead won or lost",
  CREATE_INVOICE: "Create an invoice",
  PUBLISH_REPORT: "Publish a report to a client",
};

/** Micro-dollars (1,000,000 = $1) as dollars: four places under a cent, two above. */
export const formatCost = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`;

export const formatRate = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

/** "3 min ago" style, for run lists. */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export const TOOL_LABEL: Record<string, string> = {
  "leads.read": "Read the lead",
  "leads.addNote": "Added a note to the lead",
  "leads.tag": "Tagged the lead",
  "leads.proposeOutcome": "Proposed an outcome",
  "web.fetch": "Read the website",
  "tasks.create": "Created a task",
  "projects.read": "Read the project",
  "reports.draft": "Drafted the report",
  "reports.proposePublish": "Proposed publishing",
  "notify.team": "Notified the team",
  "messages.proposeToClient": "Proposed a client message",
  "invoices.propose": "Proposed an invoice",
  "pipeline.snapshot": "Read the pipeline",
  "ai.complete": "Asked the model",
  "ai.skipped": "Skipped the model",
  "limits.rate": "Waited for its hourly limit",
  note: "Note",
};
