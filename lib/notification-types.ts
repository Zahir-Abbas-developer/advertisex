import type { BadgeTone } from "@/components/ui/Badge";

/**
 * Notification vocabulary, safe to import from client components.
 *
 * Kept apart from lib/notifications.ts, which writes rows and so imports the
 * database client: a client component importing a constant from there pulled
 * the whole data layer into the browser bundle.
 */

export const NOTIFICATION_TYPES = [
  "TASK_ASSIGNED",
  "DUE_TOMORROW",
  "OVERDUE",
  "WORK_APPROVED",
  "WORK_REJECTED",
  "REPORT_READY",
  // Phase 8 — availability checks stop borrowing DUE_TOMORROW, and the owner
  // gets a type of their own for review work that has gone stale.
  "AVAILABILITY_CHECK",
  "REVIEW_OVERDUE",
  // Phase T3 — the CRM's own events. A deal landing and a follow-up coming due
  // are the two things a salesperson must not miss.
  "LEAD_WON",
  "FOLLOW_UP_DUE",
  // Phase 4 (Advertise X) — projects.
  "PROJECT_CREATED",
  "PROJECT_UPDATED",
  "PROJECT_DEADLINE",
  "PROJECT_DELAYED",
  // Phase 6 — the client portal.
  "MESSAGE_RECEIVED",
  "REPORT_SHARED",
  "UPDATE_SHARED",
  // Phase 7 — billing.
  "INVOICE_SENT",
  "INVOICE_OVERDUE",
  "PAYMENT_RECEIVED",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TONE: Record<NotificationType, BadgeTone> = {
  TASK_ASSIGNED: "info",
  DUE_TOMORROW: "warning",
  OVERDUE: "danger",
  WORK_APPROVED: "success",
  WORK_REJECTED: "danger",
  REPORT_READY: "neutral",
  AVAILABILITY_CHECK: "warning",
  REVIEW_OVERDUE: "danger",
  LEAD_WON: "success",
  FOLLOW_UP_DUE: "warning",
  PROJECT_CREATED: "info",
  PROJECT_UPDATED: "neutral",
  PROJECT_DEADLINE: "warning",
  PROJECT_DELAYED: "danger",
  MESSAGE_RECEIVED: "info",
  REPORT_SHARED: "success",
  UPDATE_SHARED: "info",
  INVOICE_SENT: "info",
  INVOICE_OVERDUE: "danger",
  PAYMENT_RECEIVED: "success",
};
