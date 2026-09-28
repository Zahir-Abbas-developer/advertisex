import { normalizeRole, STAFF_ROLES, type Role } from "@/config/permissions";

/**
 * Route map shared by the middleware (edge runtime) and the sidebar. Keeping
 * it dependency-free — no Prisma, no React — means one definition of "who can
 * see what" instead of a guard and a nav list that can drift apart.
 */

export type NavKey =
  | "dashboard"
  | "board"
  | "clients"
  | "projects"
  | "my-tasks"
  | "tasks"
  | "pipeline"
  | "outreach"
  | "pipeline-analytics"
  | "projects-analytics"
  | "messages"
  | "my-attendance"
  | "attendance"
  | "my-performance"
  | "my-reports"
  | "disputes"
  | "incentives"
  | "audit"
  | "errors"
  | "scoring"
  | "team"
  | "team-performance"
  | "settings"
  | "reports";

export type NavItem = {
  key: NavKey;
  label: string;
  href: string;
  /** Roles allowed to open the route. */
  roles: readonly Role[];
  /**
   * How far the role restriction reaches.
   *
   * "prefix" (the default) locks the whole subtree. "exact" locks only the
   * index — used by /reports, where the listing is the owner's but a member
   * must still be able to open /reports/<id> for a report that belongs to
   * them. The page itself checks ownership.
   */
  scope?: "prefix" | "exact";
  /** Rendered as a visible-but-inert link until the phase that builds it. */
  comingSoon?: boolean;
  /**
   * Reachable and still role-gated, but not shown in the rail.
   *
   * The audit and error logs live under Settings rather than as top-level
   * entries. They stay in this list because it is what grants them admin-only
   * protection — dropping them would make /admin/audit a route nobody guards.
   */
  hidden?: boolean;
};

/**
 * Who may open each screen of the team product. These lists mirror the
 * permissions matrix (config/permissions.ts): founder configuration is
 * FOUNDER-only, the ops logs add MANAGER, everything else is staff-wide.
 * CLIENT and AI_AGENT appear nowhere here — the team product is not theirs.
 */
const ADMINS: readonly Role[] = ["FOUNDER"];
const OPS: readonly Role[] = ["FOUNDER", "MANAGER"];
const EVERYONE: readonly Role[] = STAFF_ROLES;

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", roles: EVERYONE },
  { key: "board", label: "Board", href: "/board", roles: EVERYONE },
  { key: "pipeline", label: "Pipeline", href: "/pipeline", roles: EVERYONE },
  // Company-wide lead analytics: the founder and managers, reached from the
  // pipeline header rather than the rail.
  { key: "pipeline-analytics", label: "Leads analytics", href: "/pipeline/analytics", roles: OPS, hidden: true },
  { key: "outreach", label: "Outreach", href: "/outreach", roles: EVERYONE },
  // Phase 4: managers run their departments' clients; everyone on staff
  // works projects (each sees the ones their scope allows).
  { key: "clients", label: "Clients", href: "/clients", roles: OPS },
  { key: "projects", label: "Projects", href: "/projects", roles: EVERYONE },
  { key: "projects-analytics", label: "Projects analytics", href: "/projects/analytics", roles: OPS, hidden: true },
  { key: "messages", label: "Messages", href: "/messages", roles: EVERYONE },
  { key: "tasks", label: "Tasks", href: "/tasks", roles: EVERYONE },
  // The milestone list. It belongs to the parked retainer-projects module —
  // with that module off it has no data at all, so leaving it in the rail
  // meant a "Tasks" entry that opened a permanently empty page. It is gated
  // with the rest of its module now, and /tasks is the working surface.
  { key: "my-tasks", label: "Milestones", href: "/my-tasks", roles: EVERYONE },
  {
    key: "my-attendance",
    label: "My attendance",
    href: "/my-attendance",
    roles: EVERYONE,
  },
  { key: "attendance", label: "Attendance", href: "/attendance", roles: OPS },
  {
    key: "my-performance",
    label: "My performance",
    href: "/my-performance",
    roles: EVERYONE,
  },
  {
    key: "my-reports",
    label: "My reports",
    href: "/my-reports",
    roles: EVERYONE,
  },
  {
    key: "disputes",
    label: "Disputes",
    href: "/disputes",
    roles: EVERYONE,
  },
  { key: "incentives", label: "Incentives", href: "/incentives", roles: ADMINS },
  { key: "team", label: "Team", href: "/team", roles: OPS },
  { key: "team-performance", label: "Team performance", href: "/team/performance", roles: OPS },
  {
    key: "scoring",
    label: "How scoring works",
    href: "/scoring",
    roles: EVERYONE,
  },
  { key: "settings", label: "Settings", href: "/settings", roles: ADMINS },
  { key: "audit", label: "Audit log", href: "/admin/audit", roles: OPS, hidden: true },
  { key: "errors", label: "Error log", href: "/admin/errors", roles: OPS, hidden: true },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    roles: ADMINS,
    // Members open their own report at /reports/<id>; the page checks that it
    // belongs to them.
    scope: "exact",
  },
];

/**
 * Restricted means "an EMPLOYEE may not open it" — derived from each item's
 * own role list, so adding a role to an item can never quietly strip its guard.
 */
const ADMIN_ONLY = NAV_ITEMS.filter((item) => !item.roles.includes("EMPLOYEE"));

/** Route prefixes only an admin may open, subtree included. */
export const ADMIN_ROUTE_PREFIXES = ADMIN_ONLY.filter(
  (item) => item.scope !== "exact",
).map((item) => item.href);

/** Routes where only the index itself is restricted. */
export const ADMIN_EXACT_ROUTES = ADMIN_ONLY.filter(
  (item) => item.scope === "exact",
).map((item) => item.href);

/** The nav item that governs a path, if any: exact routes first, then prefixes. */
function itemForPath(pathname: string): NavItem | undefined {
  const exact = NAV_ITEMS.find((item) => item.scope === "exact" && item.href === pathname);
  if (exact) return exact;
  return NAV_ITEMS.filter((item) => item.scope !== "exact")
    .filter((item) => pathname === item.href || pathname.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

/**
 * May this role open this page? Reads both role vocabularies; an
 * unrecognised role may open nothing. Paths no nav item governs are left to
 * the page's own guard.
 */
export function canOpenRoute(pathname: string, rawRole: unknown): boolean {
  const role = normalizeRole(rawRole);
  if (!role) return false;
  const item = itemForPath(pathname);
  return item ? item.roles.includes(role) : true;
}

export function isAdminRoute(pathname: string): boolean {
  if (ADMIN_EXACT_ROUTES.includes(pathname)) return true;

  return ADMIN_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * The rail's contents for one person.
 *
 * `hiddenKeys` carries the nav entries belonging to a disabled module. They are
 * filtered here rather than in the component so that the rail, and anything
 * else that lists navigation, cannot disagree about what is switched off.
 */
export function navItemsForRole(rawRole: unknown, hiddenKeys: readonly NavKey[] = []): NavItem[] {
  const role = normalizeRole(rawRole);
  if (!role) return [];
  return NAV_ITEMS.filter(
    (item) => item.roles.includes(role) && !item.hidden && !hiddenKeys.includes(item.key),
  );
}

/**
 * The two staff experiences (CLAUDE.md §7, "three experiences, one system").
 * Same routes, same components — a different information architecture:
 * the command center reads top-down from the business, the team shell from
 * the person's own work.
 */
export type StaffExperience = "admin" | "team";

export function experienceFor(rawRole: unknown): StaffExperience {
  return normalizeRole(rawRole) === "EMPLOYEE" ? "team" : "admin";
}

const TEAM_ORDER: readonly NavKey[] = [
  "tasks",
  "pipeline",
  "outreach",
  "board",
  "my-tasks",
  "my-attendance",
  "my-performance",
  "my-reports",
  "disputes",
  "dashboard",
  "scoring",
];

/** The rail for one person, ordered for their experience. */
export function navForExperience(
  rawRole: unknown,
  experience: StaffExperience,
  hiddenKeys: readonly NavKey[] = [],
): NavItem[] {
  const items = navItemsForRole(rawRole, hiddenKeys);
  if (experience === "admin") return items;
  const rank = (key: NavKey) => {
    const i = TEAM_ORDER.indexOf(key);
    return i === -1 ? TEAM_ORDER.length : i;
  };
  return [...items].sort((a, b) => rank(a.key) - rank(b.key));
}

/** Where a user lands after signing in. */
export const DEFAULT_LANDING = "/dashboard";
/** Where a CLIENT lands — the client portal shell. */
export const CLIENT_LANDING = "/portal";
export const LOGIN_ROUTE = "/login";

/** Clears a session whose account no longer exists, then goes to sign-in. */
export const SESSION_ENDED_ROUTE = "/session-ended";
