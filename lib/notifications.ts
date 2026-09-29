import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/score-service";
import { formatDate } from "@/lib/date";
import { dailyDigestEmail, notificationEmail } from "@/lib/email/templates";
import { normalizeRole } from "@/config/permissions";
import { CATEGORY, deliveryFor, resolvePreferences, TYPE_CATEGORY } from "@/modules/notifications/catalog";

/**
 * Notifications: in-app, and (Phase 8) email per the person's preferences.
 * Every emitter calls notify(); the channels, the audience rules and the
 * preferences are enforced there, so no call site changed when email arrived.
 *
 * Emitters never throw into their caller: a notification failing to write must
 * not roll back the approval or assignment that triggered it.
 */

export { NOTIFICATION_TYPES, NOTIFICATION_TONE, type NotificationType } from "@/lib/notification-types";
import type { NotificationType } from "@/lib/notification-types";

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
  milestoneId?: string | null;
  reportId?: string | null;
  /** Set for anything a repeated job could otherwise duplicate. */
  dedupeKey?: string | null;
};

/**
 * The one way a notification is delivered (Phase 8 makes it the whole
 * system). For every emitter:
 *
 *  1. Audience: a type only reaches the roles its category allows
 *     (modules/notifications/catalog.ts) — billing never reaches an employee,
 *     a client never gets a team task. Anything else is dropped here, so a
 *     careless emitter can't leak.
 *  2. Preference: the person's level for the category — off, in the
 *     notification center, or center + email.
 *  3. Email: sent now (bounded), recorded on the row as SENT / SKIPPED /
 *     FAILED; the morning job retries FAILED and stale PENDING.
 *
 * Never throws into its caller.
 */
export async function notify(input: NotifyInput): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, role: true, isActive: true, email: true, notificationPrefs: true },
    });
    if (!user || !user.isActive) return false;
    const role = normalizeRole(user.role);
    const level = role ? deliveryFor(input.type, role, resolvePreferences(user.notificationPrefs)) : "off";
    if (level === "off") return false;

    const row = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href ?? null,
        milestoneId: input.milestoneId ?? null,
        reportId: input.reportId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        emailState: level === "email" ? "PENDING" : null,
      },
    });
    if (level === "email") await deliverEmail(row.id);
    return true;
  } catch (error) {
    // A duplicate is the expected outcome of a re-run, not a failure.
    if (isUniqueViolation(error)) return false;
    console.error("notification failed", error);
    return false;
  }
}

/** Sends one notification's email and records the outcome on the row. */
export async function deliverEmail(notificationId: string): Promise<string> {
  // Loaded when an email is actually sent: the sender is server-only, and a
  // static import here would reach every module that notifies.
  const { appUrl, isEmailConfigured, sendEmail } = await import("@/lib/email/send");
  const n = await prisma.notification.findUnique({ where: { id: notificationId }, include: { user: { select: { email: true } } } });
  if (!n || !n.emailState || n.emailState === "SENT") return n?.emailState ?? "none";
  if (!isEmailConfigured()) {
    await prisma.notification.update({ where: { id: n.id }, data: { emailState: "SKIPPED" } });
    return "SKIPPED";
  }
  const base = appUrl();
  const type = n.type as NotificationType;
  const category = CATEGORY[TYPE_CATEGORY[type] ?? "system"];
  const result = await sendEmail(
    n.user.email,
    notificationEmail({ category: category.label, title: n.title, body: n.body, url: n.href ? `${base}${n.href}` : null, settingsUrl: `${base}${settingsPathFor(n.href)}` }),
  );
  const state = result.status === "sent" ? "SENT" : result.status === "skipped" ? "SKIPPED" : "FAILED";
  await prisma.notification.update({ where: { id: n.id }, data: { emailState: state, emailedAt: state === "SENT" ? new Date() : null } });
  return state;
}

/** Portal links go to the portal's settings; everything else to the team's. */
const settingsPathFor = (href: string | null) => (href?.startsWith("/portal") ? "/portal/settings" : "/notifications?tab=settings");

/** The morning retry: FAILED emails, and PENDING ones older than ten minutes. */
export async function retryNotificationEmails(now = new Date()) {
  const due = await prisma.notification.findMany({
    where: { OR: [{ emailState: "FAILED" }, { emailState: "PENDING", createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } }], createdAt: { gt: new Date(now.getTime() - 3 * 86_400_000) } },
    select: { id: true },
    take: 500,
  });
  let sent = 0;
  for (const n of due) if ((await deliverEmail(n.id)) === "SENT") sent += 1;
  return { retried: due.length, sent };
}

/**
 * The optional daily digest (a preference): one email with the last day's
 * unread notifications, for everyone who asked for it. Deduped per person per
 * day through a marker notification-free key on the email log (the digest
 * is idempotent by `since`: it only covers the 24 hours before `now`).
 */
export async function sendDailyDigests(now = new Date()) {
  const { appUrl, isEmailConfigured, sendEmail } = await import("@/lib/email/send");
  if (!isEmailConfigured()) return { status: "skipped" as const, sent: 0 };
  const since = new Date(now.getTime() - 86_400_000);
  const users = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: true, notificationPrefs: true } });
  let sent = 0;
  for (const u of users) {
    if (!resolvePreferences(u.notificationPrefs).digest) continue;
    const items = await prisma.notification.findMany({ where: { userId: u.id, readAt: null, createdAt: { gte: since, lt: now } }, orderBy: { createdAt: "desc" }, take: 50 });
    if (items.length === 0) continue;
    const base = appUrl();
    const portal = normalizeRole(u.role) === "CLIENT";
    const result = await sendEmail(
      u.email,
      dailyDigestEmail({
        name: u.name,
        items: items.map((i) => ({ category: CATEGORY[TYPE_CATEGORY[i.type as NotificationType] ?? "system"].label, title: i.title, body: i.body })),
        url: `${base}${portal ? "/portal/notifications" : "/notifications"}`,
        settingsUrl: `${base}${portal ? "/portal/settings" : "/notifications?tab=settings"}`,
      }),
    );
    if (result.status === "sent") sent += 1;
  }
  return { status: "ok" as const, sent };
}

// ---------------------------------------------------------------------------
// Event emitters
// ---------------------------------------------------------------------------

/** The client a workstream belongs to, for notification copy. */
export async function clientNameForModule(moduleId: string): Promise<string | null> {
  const found = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { project: { select: { client: { select: { businessName: true } } } } },
  });
  return found?.project.client.businessName ?? null;
}

export async function notifyAssigned(milestone: {
  id: string;
  title: string;
  dueDate: Date;
  assigneeId: string;
  clientName?: string | null;
}) {
  return notify({
    userId: milestone.assigneeId,
    type: "TASK_ASSIGNED",
    title: "New milestone assigned to you",
    body: `${milestone.title}${milestone.clientName ? ` · ${milestone.clientName}` : ""} — due ${formatDate(milestone.dueDate)}.`,
    href: "/my-tasks",
    milestoneId: milestone.id,
  });
}

export async function notifyApproved(milestone: {
  id: string;
  title: string;
  assigneeId: string;
  points: number;
}) {
  const impact =
    milestone.points > 0
      ? ` You earned ${milestone.points} point${milestone.points === 1 ? "" : "s"} for delivering early.`
      : milestone.points < 0
        ? ` ${Math.abs(milestone.points)} point${Math.abs(milestone.points) === 1 ? "" : "s"} came off for the late delivery.`
        : "";

  return notify({
    userId: milestone.assigneeId,
    type: "WORK_APPROVED",
    title: "Your work was approved",
    body: `${milestone.title} is signed off.${impact}`,
    href: "/my-tasks",
    milestoneId: milestone.id,
  });
}

export async function notifyRejected(milestone: {
  id: string;
  title: string;
  assigneeId: string;
  reason: string;
  points: number;
}) {
  return notify({
    userId: milestone.assigneeId,
    type: "WORK_REJECTED",
    title: "Work sent back for rework",
    body: `${milestone.title}: ${milestone.reason} (${Math.abs(milestone.points)} points deducted.)`,
    href: "/my-tasks",
    milestoneId: milestone.id,
  });
}

/**
 * Deadline warnings, raised by the evaluation pass.
 *
 * The dedupe key is per milestone per day, so a job that runs hourly still
 * produces one "due tomorrow" and one "overdue" notice rather than a stream.
 */
export async function notifyDueTomorrow(milestone: {
  id: string;
  title: string;
  dueDate: Date;
  assigneeId: string;
}, today: string) {
  return notify({
    userId: milestone.assigneeId,
    type: "DUE_TOMORROW",
    title: "Due tomorrow",
    body: `${milestone.title} is due ${formatDate(milestone.dueDate)}.`,
    href: "/my-tasks",
    milestoneId: milestone.id,
    dedupeKey: `due-tomorrow:${milestone.id}:${today}`,
  });
}

export async function notifyOverdue(milestone: {
  id: string;
  title: string;
  dueDate: Date;
  assigneeId: string;
}, today: string) {
  return notify({
    userId: milestone.assigneeId,
    type: "OVERDUE",
    title: "Overdue",
    body: `${milestone.title} passed its deadline on ${formatDate(milestone.dueDate)}.`,
    href: "/my-tasks",
    milestoneId: milestone.id,
    dedupeKey: `overdue:${milestone.id}:${today}`,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function recentFor(userId: string, take = 20) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
