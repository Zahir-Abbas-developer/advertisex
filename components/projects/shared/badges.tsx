import { Badge } from "@/components/ui/Badge";
import {
  normalizeProjectStatus,
  PROJECT_PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  SCHEDULE_LABEL,
  type ProjectPriority,
  type Schedule,
} from "@/modules/projects/domain";

export function ProjectStatusBadge({ status }: { status: string }) {
  const s = normalizeProjectStatus(status);
  return (
    <Badge dot tone={PROJECT_STATUS_TONE[s]} size="sm">
      {PROJECT_STATUS_LABEL[s]}
    </Badge>
  );
}

/** Only says something when there is something to say — on track is quiet. */
export function ScheduleBadge({ schedule, daysOverdue = 0 }: { schedule: Schedule; daysOverdue?: number }) {
  if (schedule === "ON_TRACK" || schedule === "CLOSED") return null;
  return (
    <Badge tone={schedule === "OVERDUE" ? "danger" : "warning"} size="sm">
      {schedule === "OVERDUE" && daysOverdue > 0 ? `${daysOverdue}d past deadline` : SCHEDULE_LABEL[schedule]}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  if (priority !== "HIGH" && priority !== "URGENT") return null;
  return (
    <Badge tone={priority === "URGENT" ? "danger" : "warning"} size="sm">
      {PROJECT_PRIORITY_LABEL[priority as ProjectPriority]}
    </Badge>
  );
}

export const progressTone = (schedule: Schedule) => (schedule === "OVERDUE" ? "danger" : schedule === "BEHIND" ? "warn" : "brand") as "danger" | "warn" | "brand";
