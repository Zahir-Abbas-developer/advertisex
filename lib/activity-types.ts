import type { BadgeTone } from "@/components/ui/Badge";

/**
 * The delivery activity feed's vocabulary, safe in client components.
 * lib/activity.ts writes rows and so holds the database client; it
 * re-exports these.
 */

export const ACTIVITY_TYPES = [
  "MILESTONE_CREATED",
  "STATUS_CHANGED",
  "REASSIGNED",
  "DUE_DATE_CHANGED",
  "SCORE_EVENT",
  "COMMENT_ADDED",
  "ATTACHMENT_ADDED",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TONE: Record<ActivityType, BadgeTone> = {
  MILESTONE_CREATED: "neutral",
  STATUS_CHANGED: "info",
  REASSIGNED: "info",
  DUE_DATE_CHANGED: "warning",
  SCORE_EVENT: "danger",
  COMMENT_ADDED: "neutral",
  ATTACHMENT_ADDED: "neutral",
};
