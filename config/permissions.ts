/**
 * The permissions matrix — resource × action × role → scope (CLAUDE.md §5).
 *
 * One table decides who may do what. `modules/rbac/authorize.ts` reads it;
 * nothing else encodes a permission. A cell that is absent is a refusal:
 * there is no default-allow anywhere in this file, and a role this file does
 * not know — a typo, a legacy string nobody mapped, a value written by a
 * future version — reaches no cell at all.
 *
 * Scopes say *which rows* a granted role may touch:
 *
 *   all          every row in the organization
 *   department   rows in a department the person belongs to
 *   assigned     rows the person owns or has work on
 *   own          rows that are the person themselves (their profile, their
 *                notifications, their attendance)
 *   client-own   rows belonging to the one ClientAccount a CLIENT login is
 *                scoped to
 *   grant        AI_AGENT only: allowed exactly when an explicit grant for
 *                this resource and action exists (see `AgentGrant` usage in
 *                modules/rbac/authorize.ts) — never implied by the role
 *
 * Organization isolation sits above every scope: a principal never touches a
 * row from another organization, whatever the cell says.
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = ["FOUNDER", "MANAGER", "EMPLOYEE", "CLIENT", "AI_AGENT"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  FOUNDER: "Founder",
  MANAGER: "Manager",
  EMPLOYEE: "Team member",
  CLIENT: "Client",
  AI_AGENT: "AI agent",
};

/**
 * Role strings written before the Advertise X role model, and what they now
 * mean. Kept while production still holds them (ADR-008: expand, then
 * contract) — reads accept both vocabularies so no deploy ordering can make
 * old and new strings disagree.
 */
export const LEGACY_ROLES: Readonly<Record<string, Role>> = {
  ADMIN: "FOUNDER",
  SUPPORT_ADMIN: "MANAGER",
  MEMBER: "EMPLOYEE",
};

/**
 * The one way to read a stored or session role. Returns null for anything it
 * does not recognise, and every caller treats null as *deny*: sign-in is
 * refused and `authorize()` refuses every action.
 */
export function normalizeRole(raw: unknown): Role | null {
  if (typeof raw !== "string") return null;
  if ((ROLES as readonly string[]).includes(raw)) return raw as Role;
  return LEGACY_ROLES[raw] ?? null;
}

/**
 * Every stored spelling of a role, for database filters. `where: { role:
 * "EMPLOYEE" }` would silently skip rows still holding "MEMBER" until the
 * backfill runs; `where: { role: { in: storedRoleValues("EMPLOYEE") } }`
 * matches both.
 */
export function storedRoleValues(role: Role): string[] {
  return [
    role,
    ...Object.entries(LEGACY_ROLES)
      .filter(([, mapped]) => mapped === role)
      .map(([legacy]) => legacy),
  ];
}

/** Roles that sign in to the team product (the admin and team shells). */
export const STAFF_ROLES: readonly Role[] = ["FOUNDER", "MANAGER", "EMPLOYEE"];

/** Roles that may sign in with a password at all. AI agents never do. */
export const INTERACTIVE_ROLES: readonly Role[] = ["FOUNDER", "MANAGER", "EMPLOYEE", "CLIENT"];

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

/**
 * `reveal` exists for one thing: opening a sealed secret in the credentials
 * vault. Seeing that a credential exists (`read`) and seeing the secret are
 * different privileges, and the second is audited every time.
 */
export const ACTIONS = ["read", "create", "update", "delete", "manage", "reveal"] as const;
export type Action = (typeof ACTIONS)[number];

export type Scope = "all" | "department" | "assigned" | "own" | "client-own" | "grant";

export const RESOURCES = [
  /** Founder-only configuration: team, settings, services, departments, money. */
  "admin",
  /** Operational oversight: error log, audit trail. */
  "ops",
  "lead",
  "client",
  "clientAccount",
  "task",
  "activity",
  "department",
  "delivery",
  "attendance",
  "analytics",
  "report",
  "notification",
  "profile",
  "file",
  /** An employee's profile, skills, schedule and performance (Phase 2). */
  "employee",
  /** The organization's skills taxonomy (Phase 2). */
  "skill",
  /** Client projects: plan, stages, milestones, team (Phase 4). */
  "project",
  /** The client credentials vault (Phase 4). */
  "credential",
  /** Client–team conversations (Phase 6). The founder channel is narrowed further in modules/messages. */
  "message",
  /** A client's reports library (Phase 6). */
  "clientReport",
  /** Client portal logins and invitations (Phase 6). A client OWNER manages their own account's. */
  "portalUser",
] as const;
export type Resource = (typeof RESOURCES)[number];

type Row = Partial<Record<Role, Scope>>;
type Matrix = Record<Resource, Partial<Record<Action, Row>>>;

const FOUNDER_ONLY: Row = { FOUNDER: "all" };

export const PERMISSIONS: Matrix = {
  admin: {
    read: FOUNDER_ONLY,
    create: FOUNDER_ONLY,
    update: FOUNDER_ONLY,
    delete: FOUNDER_ONLY,
    manage: FOUNDER_ONLY,
    reveal: FOUNDER_ONLY,
  },

  ops: {
    read: { FOUNDER: "all", MANAGER: "all" },
    // Reporting a crash from one's own session (the error boundary's POST).
    create: { FOUNDER: "own", MANAGER: "own", EMPLOYEE: "own", CLIENT: "own" },
  },

  // Sales pipeline. Department-scoped for everyone below the founder, as it
  // has been since the BWM doctrine (ADR-006).
  lead: {
    read: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department", AI_AGENT: "grant" },
    create: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department", AI_AGENT: "grant" },
    update: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department", AI_AGENT: "grant" },
    delete: { FOUNDER: "all", MANAGER: "department" },
  },

  // A client's CRM record. Employees see the clients they own or work on; a
  // CLIENT sees only its own account's records.
  client: {
    read: {
      FOUNDER: "all",
      MANAGER: "department",
      EMPLOYEE: "assigned",
      CLIENT: "client-own",
      AI_AGENT: "grant",
    },
    create: { FOUNDER: "all", MANAGER: "department" },
    update: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "assigned" },
    delete: FOUNDER_ONLY,
  },

  // The restaurant's portal tenant (skeleton in Phase 1).
  clientAccount: {
    read: { FOUNDER: "all", MANAGER: "all", CLIENT: "client-own" },
    create: FOUNDER_ONLY,
    update: FOUNDER_ONLY,
    delete: FOUNDER_ONLY,
  },

  task: {
    read: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department", AI_AGENT: "grant" },
    create: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department", AI_AGENT: "grant" },
    update: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department", AI_AGENT: "grant" },
    delete: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department" },
  },

  // The activity timeline on leads and clients.
  activity: {
    read: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department", AI_AGENT: "grant" },
    create: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department", AI_AGENT: "grant" },
    delete: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "own" },
  },

  // Reading a department's shape (its form, its stages) to work in it.
  department: {
    read: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department" },
  },

  // Projects, milestones, the board, capacity — the parked delivery module.
  delivery: {
    read: { FOUNDER: "all", MANAGER: "all", EMPLOYEE: "assigned" },
    update: { FOUNDER: "all", MANAGER: "all", EMPLOYEE: "assigned" },
  },

  // A person's own attendance, breaks, leave, outages, disputes. Everyone
  // clocks themselves in; the team view and schedules are the founder's and
  // (read-only) a manager's. AI agents have no attendance at all.
  attendance: {
    read: { FOUNDER: "all", MANAGER: "all", EMPLOYEE: "own" },
    create: { FOUNDER: "own", MANAGER: "own", EMPLOYEE: "own" },
    update: { FOUNDER: "all", MANAGER: "all", EMPLOYEE: "own" },
    manage: FOUNDER_ONLY,
  },

  analytics: {
    read: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "department" },
  },

  report: {
    read: { FOUNDER: "all", MANAGER: "all", EMPLOYEE: "own", CLIENT: "client-own" },
    create: FOUNDER_ONLY,
  },

  notification: {
    read: { FOUNDER: "own", MANAGER: "own", EMPLOYEE: "own", CLIENT: "own" },
    update: { FOUNDER: "own", MANAGER: "own", EMPLOYEE: "own", CLIENT: "own" },
    create: { FOUNDER: "own", MANAGER: "own", EMPLOYEE: "own", CLIENT: "own" },
    delete: { FOUNDER: "own", MANAGER: "own", EMPLOYEE: "own", CLIENT: "own" },
  },

  profile: {
    read: { FOUNDER: "own", MANAGER: "own", EMPLOYEE: "own", CLIENT: "own" },
    update: { FOUNDER: "own", MANAGER: "own", EMPLOYEE: "own", CLIENT: "own" },
  },

  file: {
    read: { FOUNDER: "all", MANAGER: "all", EMPLOYEE: "assigned", CLIENT: "client-own" },
    create: { FOUNDER: "all", MANAGER: "all", EMPLOYEE: "assigned" },
    delete: { FOUNDER: "all", MANAGER: "all", EMPLOYEE: "own" },
  },

  // The directory, profiles and team performance (Phase 2). A manager sees
  // the people in their own departments; an employee sees themselves.
  employee: {
    read: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "own" },
    update: FOUNDER_ONLY,
    manage: FOUNDER_ONLY,
  },

  skill: {
    read: { FOUNDER: "all", MANAGER: "all", EMPLOYEE: "all" },
    create: FOUNDER_ONLY,
    update: FOUNDER_ONLY,
  },

  // Client projects (Phase 4). A manager runs the projects of their
  // departments' clients; an employee works on the projects they are a
  // member of (or own a milestone in) — updating the plan's progress, not
  // its shape (the handlers narrow what "update" means for them).
  project: {
    // CLIENT: their own account's projects, through the portal's own views.
    read: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "assigned", CLIENT: "client-own" },
    create: { FOUNDER: "all", MANAGER: "department" },
    update: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "assigned" },
    delete: FOUNDER_ONLY,
  },

  // The credentials vault. Everyone who works on a client may know which
  // logins exist and open them when the work needs it — every reveal is
  // audited. Changing what is stored is for the founder and managers.
  credential: {
    read: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "assigned" },
    reveal: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "assigned" },
    create: { FOUNDER: "all", MANAGER: "department" },
    update: { FOUNDER: "all", MANAGER: "department" },
    delete: { FOUNDER: "all", MANAGER: "department" },
  },

  // Phase 6. Team threads: the founder sees all; a manager their
  // departments' clients; an employee the clients they work for; a client
  // their own. The private founder channel is founder-and-client only — that
  // rule lives in modules/messages, on top of this.
  message: {
    read: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "assigned", CLIENT: "client-own" },
    create: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "assigned", CLIENT: "client-own" },
  },

  clientReport: {
    read: { FOUNDER: "all", MANAGER: "department", EMPLOYEE: "assigned", CLIENT: "client-own" },
    create: { FOUNDER: "all", MANAGER: "department" },
    update: { FOUNDER: "all", MANAGER: "department" },
    delete: { FOUNDER: "all", MANAGER: "department" },
  },

  // Inviting and removing portal logins. A CLIENT may do it for their own
  // account only if they are its OWNER (checked in modules/portal).
  portalUser: {
    read: { FOUNDER: "all", MANAGER: "department", CLIENT: "client-own" },
    create: { FOUNDER: "all", MANAGER: "department", CLIENT: "client-own" },
    delete: { FOUNDER: "all", MANAGER: "department", CLIENT: "client-own" },
  },
};

/** The scope a role holds for an action on a resource, or null for refusal. */
export function scopeFor(role: Role, action: Action, resource: Resource): Scope | null {
  return PERMISSIONS[resource]?.[action]?.[role] ?? null;
}
