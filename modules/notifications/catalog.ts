/**
 * The notification catalog (Phase 8 scope 5). Pure and client-safe: every
 * notification type belongs to one category; each category has who may
 * receive it, a default channel, and whether it can be switched off. User
 * preferences are one level per category. lib/notifications.ts · notify()
 * enforces all of it for every emitter.
 */

import type { Role } from "@/config/permissions";
import type { NotificationType } from "@/lib/notification-types";

export const CATEGORIES = ["tasks", "deadlines", "projects", "updates", "messages", "reports", "billing", "sales", "announcements", "system"] as const;
export type Category = (typeof CATEGORIES)[number];

/** Off, in the notification center only, or in the center and by email. */
export const LEVELS = ["off", "app", "email"] as const;
export type Level = (typeof LEVELS)[number];

const STAFF: readonly Role[] = ["FOUNDER", "MANAGER", "EMPLOYEE", "AI_AGENT"];
const EVERYONE: readonly Role[] = ["FOUNDER", "MANAGER", "EMPLOYEE", "AI_AGENT", "CLIENT"];

export type CategoryInfo = {
  label: string;
  description: string;
  /** Roles that may ever receive it — notify() drops anything else. */
  audience: readonly Role[];
  defaultLevel: Level;
  /** The lowest level a person may choose (important notices can't be muted). */
  minimum: Level;
};

export const CATEGORY: Record<Category, CategoryInfo> = {
  tasks: { label: "Tasks", description: "Work assigned to you, approvals and rejections", audience: STAFF, defaultLevel: "email", minimum: "app" },
  deadlines: { label: "Deadlines", description: "Due soon and overdue", audience: STAFF, defaultLevel: "email", minimum: "app" },
  projects: { label: "Projects", description: "New projects and changes to yours", audience: STAFF, defaultLevel: "app", minimum: "off" },
  updates: { label: "Project updates", description: "Progress your team shares with you", audience: ["CLIENT"], defaultLevel: "email", minimum: "off" },
  messages: { label: "Messages", description: "New messages in your conversations", audience: EVERYONE, defaultLevel: "email", minimum: "off" },
  reports: { label: "Reports", description: "New reports, and reports waiting for review", audience: EVERYONE, defaultLevel: "email", minimum: "off" },
  billing: { label: "Billing", description: "New invoices, payments received, payments overdue", audience: ["FOUNDER", "CLIENT"], defaultLevel: "email", minimum: "app" },
  sales: { label: "Sales", description: "Deals won and follow-ups due", audience: STAFF, defaultLevel: "app", minimum: "off" },
  announcements: { label: "Announcements", description: "News from the founders", audience: EVERYONE, defaultLevel: "email", minimum: "app" },
  system: { label: "Other", description: "Availability checks and review reminders", audience: STAFF, defaultLevel: "app", minimum: "app" },
};

export const TYPE_CATEGORY: Record<NotificationType, Category> = {
  TASK_ASSIGNED: "tasks",
  WORK_APPROVED: "tasks",
  WORK_REJECTED: "tasks",
  DUE_TOMORROW: "deadlines",
  OVERDUE: "deadlines",
  PROJECT_DEADLINE: "deadlines",
  PROJECT_DELAYED: "deadlines",
  PROJECT_CREATED: "projects",
  PROJECT_UPDATED: "projects",
  UPDATE_SHARED: "updates",
  MESSAGE_RECEIVED: "messages",
  REPORT_READY: "reports",
  REPORT_SHARED: "reports",
  INVOICE_SENT: "billing",
  INVOICE_OVERDUE: "billing",
  PAYMENT_RECEIVED: "billing",
  LEAD_WON: "sales",
  FOLLOW_UP_DUE: "sales",
  ANNOUNCEMENT: "announcements",
  AVAILABILITY_CHECK: "system",
  REVIEW_OVERDUE: "system",
};

/**
 * The founder's event list (Phase 8 scope 5), and the types that carry each.
 * `notifytest` fires every one of these.
 */
export const EVENTS = {
  taskAssigned: ["TASK_ASSIGNED"],
  newProject: ["PROJECT_CREATED"],
  deadlineApproaching: ["DUE_TOMORROW", "PROJECT_DEADLINE"],
  taskOverdue: ["OVERDUE"],
  newClientMessage: ["MESSAGE_RECEIVED"],
  newReport: ["REPORT_SHARED", "REPORT_READY"],
  newInvoice: ["INVOICE_SENT"],
  paymentReceived: ["PAYMENT_RECEIVED"],
  paymentOverdue: ["INVOICE_OVERDUE"],
  projectUpdate: ["PROJECT_UPDATED", "UPDATE_SHARED"],
  founderAnnouncement: ["ANNOUNCEMENT"],
} as const satisfies Record<string, readonly NotificationType[]>;

export type Preferences = { levels: Record<Category, Level>; digest: boolean };

const rank = (l: Level) => LEVELS.indexOf(l);
const isLevel = (v: unknown): v is Level => typeof v === "string" && (LEVELS as readonly string[]).includes(v);

/** The categories a role can receive — the ones its preferences page shows. */
export const categoriesFor = (role: Role): Category[] => CATEGORIES.filter((c) => CATEGORY[c].audience.includes(role));

export function defaultPreferences(): Preferences {
  return { levels: Object.fromEntries(CATEGORIES.map((c) => [c, CATEGORY[c].defaultLevel])) as Record<Category, Level>, digest: false };
}

/**
 * Stored preferences (User.notificationPrefs, JSON) → a full set. Understands
 * the Phase 6 portal format ({ messages, reports, updates } booleans: false
 * meant muted). Anything unknown falls back to the default, and no level is
 * allowed below its category's minimum.
 */
export function resolvePreferences(raw: string | null | undefined): Preferences {
  const out = defaultPreferences();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === "object") {
    const p = parsed as Record<string, unknown>;
    const levels = (p.levels && typeof p.levels === "object" ? p.levels : {}) as Record<string, unknown>;
    for (const c of CATEGORIES) {
      if (isLevel(levels[c])) out.levels[c] = levels[c] as Level;
      else if (typeof p[c] === "boolean") out.levels[c] = p[c] ? CATEGORY[c].defaultLevel : "off"; // Phase 6 format
    }
    if (typeof p.digest === "boolean") out.digest = p.digest;
  }
  for (const c of CATEGORIES) if (rank(out.levels[c]) < rank(CATEGORY[c].minimum)) out.levels[c] = CATEGORY[c].minimum;
  return out;
}

export const serializePreferences = (p: Preferences) => JSON.stringify({ v: 2, levels: p.levels, digest: p.digest });

/**
 * How one notification is delivered to one person: not at all (wrong
 * audience, or muted), in the center, or in the center and by email.
 */
export function deliveryFor(type: NotificationType, role: Role, prefs: Preferences): Level {
  const category = TYPE_CATEGORY[type];
  if (!CATEGORY[category].audience.includes(role)) return "off";
  return prefs.levels[category];
}
