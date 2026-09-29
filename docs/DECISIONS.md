# Architecture Decision Records

*Format: context → decision → alternatives → consequences. Status is `Proposed`
until the founder approves the Phase 0 report; `Accepted` after. Superseding an
ADR requires a new ADR, never an edit.*

---

## ADR-001 — Stack continuity over the doctrine's default stack

**Status:** Accepted (founder, 2026-09-25)

**Context.** CLAUDE.md §5 lists a default stack (pnpm-flavored commands, shadcn/ui,
`src/modules/`, tRPC option, Inngest) but states: *"adopt only where it doesn't
conflict with what Metroctopus already uses; continuity beats novelty."* The repo
is npm, root-level `app/`, hand-built Tailwind primitives, route handlers, Vercel
cron — working, tested (479 unit tests + 6 HTTP harnesses), and live.

**Decision.** Keep Next.js 14 App Router, TypeScript strict, npm, root-level
`app/`, the hand-built component library, and route handlers. Adopt from the
default stack only: Zod-at-every-boundary (finishing what's partial), the
`modules/` structure — introduced incrementally as each domain is touched, under
`modules/` beside `lib/` — and the `jobs/` abstraction. No shadcn (we have
primitives with better provenance and the design system §7 requires heavy
customization either way), no tRPC (typed route handlers + Zod suffice at this
scale), no `src/` move (churns every import for zero behavior).

**Alternatives.** Full doctrine stack (rejected: violates its own continuity rule;
weeks of churn, no user value) · big-bang `modules/` restructure (rejected: same
churn risk; incremental extraction keeps every commit shippable).

**Consequences.** §11 commands are npm. New engineers see two layouts (`lib/` and
`modules/`) during the transition; the rule is: extracted modules never import
back into un-extracted `lib/` internals, only the reverse.

---

## ADR-002 — Auth: harden NextAuth credentials; defer providers

**Status:** Accepted (founder, 2026-09-25)

**Context.** §5 offers Auth.js/Clerk/Supabase. Today: NextAuth v4 credentials,
bcrypt, login rate limiting, forced first-login change, admin resets — all tested
(`passwords.test.ts`, harnesses). §6 requires invite-only creation, email
verification, strong policy, multi-tenant claims.

**Decision.** Keep NextAuth credentials as the mechanism. Build §6's missing
pieces on top: `Invite` entity (admin/founder-issued, role + tenant baked into
the token), email verification on accept, password policy in `lib/passwords.ts`,
org/clientAccount claims resolved server-side per request (as `Viewer` already is
— never trusted from the session). Revisit a hosted provider (Clerk) only if/when
SSO or social login becomes a requirement; that would be its own ADR.

**Alternatives.** Clerk now (rejected: migration cost + vendor coupling before the
tenancy model even exists; nothing in scope needs it) · Auth.js v5 upgrade
(deferred: mechanical, do it opportunistically in P2+).

**Consequences.** We own password + session security; the harness suite keeps
proving it. Invite-only lands with tenancy (P2/P3), not before.

---

## ADR-003 — ORM & migrations: Prisma stays; `db push` is demoted

**Status:** Accepted (founder, 2026-09-25)

**Context.** Prisma 5.22 throughout; dev on SQLite, prod on Neon Postgres, provider
flipped by script. There is **no migration history** — prod evolved by `db push`
(R1). The stale checked-in `prisma/migrations/` already broke one deploy (9 Sep).

**Decision.** Prisma stays (no Drizzle rewrite — zero payoff against 41 working
models). In P1: delete the stale migrations folder, snapshot the live Postgres
schema as baseline migration 0001, and from then on schema changes ship as
versioned migrations run by CI/deploy. `db push` remains allowed for local SQLite
prototyping only. The SQLite/Postgres dual-provider setup stays until tenancy work
begins, then dev moves to Postgres (docker or Neon branch) so RLS and migration
parity are testable — recorded now so it isn't a surprise later.

**Alternatives.** Drizzle (rejected: churn) · keep `db push` (rejected: R1 —
unreplayable prod schema blocks the tenancy retrofit).

**Consequences.** Deploys gain a migrate step; the `vercel-build` seed step stops
being the schema mechanism.

---

## ADR-004 — Jobs: Vercel cron behind a `jobs/` interface; queue when earned

**Status:** Accepted (founder, 2026-09-25)

**Context.** 4 crons exist, bearer-authed. The Hobby plan's daily-only limit
already forced the follow-ups cron into an 8–10am window compromise. §5 wants
Inngest/Trigger/BullMQ behind one abstraction.

**Decision.** Introduce `modules/jobs` now as a thin registry (`defineJob`,
`enqueue`, cron entrypoints call through it, every run logged). Keep Vercel cron
as the only executor until a real need appears — retries, fan-out, sub-daily
scheduling, AI task queues (P5). Then adopt Inngest inside the abstraction, which
also lifts the Hobby compromise.

**Alternatives.** Inngest now (rejected: infra + vendor before any queue-shaped
workload exists — over-engineering past the two-phase horizon).

---

## ADR-005 — Tenancy: shared schema, scoped repositories, RLS second

**Status:** Accepted (founder, 2026-09-25)

**Context.** §5 mandates Organization/ClientAccount from day one; today nothing is
tenancy-keyed and one aggregate has already leaked once by bypassing the scope
helper (dashboard tile, fixed + harness-covered).

**Decision.** Shared-schema multi-tenancy: `organizationId` on every tenant-owned
table, `clientAccountId` on client-scoped ones, backfill to org #1. All access
through repositories that take a `Scope` object and inject it — generalizing the
proven `departmentScope(viewer)` pattern rather than replacing it (departments
remain the intra-org dimension). Postgres RLS added as the second wall once
ADR-003's baseline exists. Isolation tests per entity extend the existing
permtest pattern: both directions, planted foreign records, rendered pages as
well as APIs.

**Alternatives.** Schema-per-tenant (rejected: operational cost absurd at this
stage; shared-schema + RLS is the industry default for this shape) · RLS-only
(rejected: SQLite dev can't express it; repositories give one testable seam now).

---

## ADR-006 — Reconciling the BWM doctrine (docs/legacy/BWM_CLAUDE.md)

**Status:** Accepted (founder, 2026-09-25 — D1–D5 recorded below)

**Context.** The codebase was built under `docs/legacy/BWM_CLAUDE.md`. The new
CLAUDE.md replaces it. Four load-bearing BWM rules need explicit disposition, not
silent override.

**Decisions, per rule:**

1. **Design freeze** (*"Design is frozen … Redesigning anything is a defect"* —
   legacy §Core Doctrine 1). **Superseded** by CLAUDE.md §7 Obsidian & Gold —
   the new doctrine explicitly replaces the visual identity. What is *preserved*
   is the freeze's mechanism: once `DESIGN_SYSTEM.md` exists (P1), it becomes law
   exactly as the BWM system was, and deviation is again a defect. Founder
   confirmation folded into **D3** (the retheme is large and touches every screen).

2. **Department scoping** (legacy §Core Doctrine 2: *"a query that forgets to
   scope by department is a data-leak bug"*). **Preserved and generalized.**
   Departments remain a first-class scope *inside* an organization; tenancy adds
   two outer rings (org, clientAccount). The enforcement style — server-side,
   serializer-stripped, tested in both directions — is preserved verbatim and
   becomes the tenancy test standard (ADR-005).

3. **Stability gate** (legacy §Stability gate: smoke ×2, permtest, leaks, tsc,
   tests; browser pass when renders change). **Preserved and extended.** The new
   §9 Definition of Done adds `lint` and `build` (both green today) and the
   responsive checks. The six BWM harnesses stay authoritative; tenancy isolation
   tests join them in P2. Nothing from the legacy gate is dropped.

4. **Parked modules** (legacy §Parked modules: attendance, scoring, retainer
   cycles, client KPIs — *"do not delete the code"*). **Needs founder decision —
   folded into D4.** Analysis: *attendance* and *scoring* map directly onto the
   Team OS pillar (§1.2) and are candidates to **unpark and adapt**; *retainer
   cycles* overlaps the future `projects` module — likely **superseded**, keep
   parked until P4 decides; *client KPIs* is **superseded** by
   `modules/integrations` + `MetricSnapshot` (real provider data instead of
   hand-entered ROAS) — keep parked, delete only after integrations ship. Until
   D4 is answered, all four stay exactly as the legacy doctrine demands: flagged
   off, invisible, code intact.

**Also carried forward from the legacy file, unchanged because they are doctrine-
agnostic engineering truths:** config-lives-in-the-database; off-is-invisible;
designed empty states; never diagnose from the browser; errors recorded to
`/api/system-errors`; the converge seed; forced password change on placeholder
credentials.


---

## Founder decisions — Phase 0 gate (2026-09-25)

Recorded verbatim with the working interpretation each one is being executed
under. If an interpretation is wrong, correcting it is a one-line reply and the
docs update before the affected code does.

**"phase 0 approved"** — gate passed; Phase 1 authorized per ASSESSMENT §11.

**D1 — "bwm replaces with AdvertiseX."** Option (b): the product and the live
instance become Advertise X; the BWM brand is retired everywhere. Interpretation:
*brand and copy* change; the six existing user accounts, their emails and their
data stay untouched (changing seed emails would orphan real logins — the converge
seed matches users by email). `ServiceCatalog`/`ServiceLead`/`isBusinessDev`
deletion is unblocked but scheduled for P2 alongside the repository extraction,
not rushed into P1.

**D2 — "departments our services and food businesses."** Departments remain the
mechanism and become **Advertise X's service lines serving food & drink brands**.
Seed replaced with service lines derived from the founder's own playbook
(Appetite Audit entry offer, 90-Day Growth Sprint core): Appetite Audits · Paid
Ads — Growth Sprint · Creative Studio · Web & Retention — each with its own
pipeline stages and field sets. Existing BWM departments are not deleted from
production data (the seed converges, never destroys); the founder deactivates
them in Settings when ready.

**D3 — "continue with yours choice."** Full Obsidian & Gold token swap in Phase 1
(ADR-006.1), plus `docs/DESIGN_SYSTEM.md` which then becomes law exactly as the
BWM freeze was.

**D4 — "use which is feasible."** Feasibility delegated. Execution: all four
modules stay parked through Phase 1 (zero cost, zero risk); attendance + scoring
unpark and adapt when the Team OS phase arrives (P6); retainer cycles and client
KPIs treated as superseded per ADR-006.4 and deleted only after their
replacements ship.

**D5 — "no yet."** Read as "not yet" to a hosted auth provider: ADR-002 stands —
hardened NextAuth credentials, invites and verification built on top in P2/P3.

## ADR-007 — The founder's Phase 1 prompt supersedes the ASSESSMENT §11 proposal

**Date:** 2026-09-25 · **Status:** accepted

**Context.** Phase 0 ran without `docs/PHASES.md`. Its report proposed a lean
Phase 1 ("Identity & Shell") and the founder approved the gate. Mid-phase, the
founder issued the real Phase 1 prompt (now recorded verbatim in
`docs/PHASES.md`): rebrand · modular architecture · multi-tenancy · auth ·
RBAC · design system · app shells. The founder's prompt is the source of truth
(CLAUDE.md §2), so the phase re-baselines around it. Work already shipped
(rebrand, Obsidian & Gold, D2 service-line seed) sits inside its scope items
1, 7 and 11 and carries forward unchanged.

**What this supersedes.**
- **ADR-001's "no `src/` move".** Scope 2 explicitly orders the §5 modular
  structure. That was ADR-001's call to make cheaply and is now the founder's
  call to make properly. Approach: *incremental, behavior-preserving* — new
  foundation code (tenancy, rbac, repositories) is born in the final
  structure; existing feature code moves module by module, each move a
  commit with the full gate green, every move listed in the phase report.
  A big-bang tree move of a working 479-test codebase in one commit is the
  rewrite-by-stealth §3.2 forbids.
- **Role model.** `ADMIN / SUPPORT_ADMIN / MEMBER` (+ per-department `LEAD`)
  becomes `FOUNDER / MANAGER / EMPLOYEE / CLIENT / AI_AGENT`. Mapping:
  ADMIN→FOUNDER, SUPPORT_ADMIN→MANAGER, MEMBER→EMPLOYEE; CLIENT and AI_AGENT
  are new. Migration is additive-first on the populated production database
  (new column/values in, backfill, cut over reads, retire old) — never a
  destructive enum rewrite. Per-department LEAD stays: it is a scope rule
  ("department"), not a role.

**Sequencing decision.** Schema + permissions matrix + `authorize()` land
before the module moves; the moves then carry code into a structure that
already has its foundations, instead of moving twice.

**Alternatives rejected.** Treating the pasted prompt as Phase 2 (it names
itself Phase 1 and its prerequisite is "Phase 0 approved"); pausing shipped
work for a from-scratch restart (§3.2).

## ADR-008 — Deploying Phase 1 without risking production

**Date:** 2026-09-25 · **Status:** accepted

Two founder concerns, raised before the Phase 1 commits: the migration
baseline must not execute SQL against live production, and the role
vocabulary change must not let old and new code disagree about a role.

### 1. The migration baseline

- **Mechanism.** `scripts/migrate-deploy.mjs` marks `00000000000000_baseline`
  applied with `prisma migrate resolve --applied`. That writes one row to
  `_prisma_migrations` and executes none of the baseline's SQL. Only the
  migrations after it run, and the first one (`advertisex_foundation`) is
  purely additive: two new tables, five nullable columns, indexes, and
  foreign keys that allow null.
- **Gate.** The one-time baseline of a populated database refuses to run
  unless `BASELINE_BACKUP_CONFIRMED=1` is set. Without it the build exits 1
  before touching anything, and Vercel keeps serving the previous deployment.
- **Rehearsal (2026-09-25, local Postgres 18).** Three paths, all passed:
  (a) a database in production's state, with every table present from `db push`
  and no ledger: baselined, then only the foundation migration applied;
  a second run found nothing pending. (b) The same state loaded with the
  pre-Phase-1 seed (6 accounts, 4 BWM departments): after the full
  vercel-build database sequence, all 6 accounts kept identical emails, roles
  and password hashes, every row got its organization, and zero drift from
  `schema.prisma`. (c) An empty database: baseline and foundation both
  *executed*, zero drift. The rehearsal caught one real bug, `prisma` not on
  PATH outside npm scripts (fixed: `npx prisma`).
- **Not yet done: a clone of production's actual data, and a backup.**
  Vercel stores `DATABASE_URL` as a sensitive variable and `env pull` returns
  it redacted, so neither is possible from the development machine. Before
  the first Phase 1 deploy the founder (or whoever holds Neon access) creates
  a **Neon branch** of production, which gives a backup and a real clone in one
  step, and the rehearsal is repeated against that branch's URL. Only then is
  `BASELINE_BACKUP_CONFIRMED=1` set.

### 2. The role vocabulary: expand, then contract, *not* one deploy

The founder asked that the database backfill and the code sweep ship
together. The goal is right: old and new code must never read each other's
role strings. But one Vercel deploy does not achieve it. `vercel-build` runs
migrations and the seed *before* the new build goes live, while the previous
deployment is still serving. A backfill inside that build rewrites roles
under the old code.

Audit of the current code shows what that window would do: every authority
check has the shape `hasAdminPower(role) ? admin : member` (104 call sites),
so an unrecognised string falls to *member-level* access. For FOUNDER that is
fail-closed (admin lost for the length of the window). For **CLIENT and
AI_AGENT it is fail-open**: old code would treat a restaurant's login as a
team member.

So the rollout is expand/contract:

1. **Expand (the Phase 1 deploy).** New code reads roles through
   `normalizeRole()`, which maps both vocabularies (ADMIN→FOUNDER,
   SUPPORT_ADMIN→MANAGER, MEMBER→EMPLOYEE) and returns `null` for anything
   else. `null` is **deny**: sign-in is refused, and `authorize()` refuses
   every action. The database is *not* rewritten, and no CLIENT or AI_AGENT
   account exists in production, so the old deployment never meets a string
   it cannot handle.
2. **Contract (after the new deployment is live and verified).** Run
   `npm run roles:backfill` once. It rewrites legacy role strings to the new
   ones and creates the new-role seed accounts. The old code is gone by then.
   A later phase can drop legacy-name support once production holds none.

Because the new code accepts both vocabularies, the backfill can run at any
point after step 1 with no behaviour change, and running it twice is harmless.

## ADR-009 — Tenancy and audit enforced in the Prisma client, not per-module repositories

**Date:** 2026-09-25 · **Status:** accepted

**Context.** Phase 1 scope 4 asks for a tenant-scoped data-access layer with
"no raw unscoped queries anywhere", and scope 9 for audit logging "wired into
the data layer for all mutations". ADR-005 anticipated per-module
repositories. But the codebase has ~80 route handlers and dozens of server
components that call `prisma.*` directly; converting every one to a
repository is the module migration itself, and would leave the app unscoped
until the last handler moved.

**Decision.** Both walls live in the one shared Prisma client
(`lib/prisma.ts`), as client extensions every query passes through:

- `modules/tenancy` — inside a signed-in request, every query on a
  tenant-owned model is rewritten by the pure `scopeArgs()` to the caller's
  organization: roots (`User`, `Department`, `Client`, `ClientAccount`,
  `AgentGrant`, `AuditLog`) by `organizationId`, department-owned rows
  (`Lead`, `Task`, `SalesActivity`, `PipelineStage`, `FieldDefinition`,
  `DepartmentMembership`) through their department. Creates are stamped;
  a caller-supplied organization is overwritten, never trusted. A signed-in
  account with no organization is refused, not run unscoped.
- `modules/audit` — every create/update/delete of a business entity writes
  `AuditLog` with actor, actor type (HUMAN/AI/CLIENT/SYSTEM), organization
  and a before/after diff (changed fields only; password hashes redacted).
  Never throws into the mutation it records.

**Why this over repositories now.** It makes the guarantee *structural*
today, for every existing call site, instead of eventually. The module
repositories ADR-005 describes still come, module by module — they then
inherit the wall rather than being the only thing standing in for it.

**Evidence.** `tests/tenancy-scope.test.ts` and `tests/audit-entry.test.ts`
cover the rules without a database. `scripts/tenanttest.mjs` plants a whole
second organization and proves organization #1's founder sees none of it
across 24 checks — and, mutation-tested, that with the wall disabled 12 of
those checks fail at once: before this change a founder's
`departmentScope` returned *every* organization's rows.

**Limits, stated.** Outside a request (cron, seeds, scripts) queries run
unscoped as the system; jobs carrying an organization context is Phase 2.
Scheduled-job audit rows have no organization and are visible to the ops
roles of the (single) organization. Models reached only through a scoped
parent (notifications, field values, the parked delivery module) are not
filtered themselves. Postgres Row-Level Security remains the second wall
(ADR-005).

**Side effect found and fixed.** Client components imported constants from
server modules (`lib/notifications`, `lib/fields`, `lib/audit`) and so pulled
the database client into the browser bundle unnoticed. The wall's session
dependency made that a build error; each module is now split into a
client-safe half (`lib/notification-types`, `lib/fields`, `lib/audit-actions`)
and a server half (`lib/notifications`, `lib/fields-data`, `lib/audit`).

## ADR-010 — MANAGER is department-scoped; the maintainer account changes

**Date:** 2026-09-25 · **Status:** accepted, **founder to confirm**

The legacy `SUPPORT_ADMIN` role (one account: the system maintainer) had
exactly the owner's powers. It reads as MANAGER under the Advertise X role
model (ADR-007/008), and the Phase 1 prompt's acceptance requires that
"MANAGER scope holds". So the maintainer now: keeps full lead editing in
every department he belongs to (all four service lines), keeps the audit and
error logs (`ops`), and **loses** founder configuration (team, settings,
services, departments) and money views.

If the founder wants the maintainer to keep owner-level access, the change is
one line — set that account's role to FOUNDER — and nothing in the model has
to bend. Recorded here so the change is a decision, not a surprise.

## ADR-011 — Phase 2: the team operating system on the existing models

**Date:** 2026-09-26 · **Status:** accepted

**Attendance is core again; the old machinery stays parked.** D4 parked the
BWM attendance module, which was a surveillance-shaped system (random presence
checks, outage reports) built on a Karachi clock. Phase 2 asks for attendance
as a professional feature. So: a new engine (`modules/attendance/domain.ts`,
pure and tested) and a new time clock (`/api/time`) reuse the existing
`AttendanceDay` and `BreakSession` tables. The `/my-attendance` and
`/attendance` pages now run on it, outside the flag. What stays behind the
flag, relabelled "Availability checks", is only the legacy APIs (random
checks, outages, leave workflow). Nothing is deleted.

**Every employee's own clock.** Attendance is measured against a per-person
`WorkSchedule` in its own IANA timezone (default: company timezone, Mon–Fri
09:00–17:00, 5 minutes' grace). Days are stored at UTC midnight of the
employee's local date; nothing derived (worked, late, absent) is stored, so a
schedule change re-reads history consistently.

**One span per day.** Clock in once, breaks inside, clock out once. A second
clock-in or a clock-out without a clock-in is refused. This keeps the model and
the numbers simple; split shifts can come later without a schema change (a day
can own several spans).

**Task statuses: expand, then contract (as ADR-008).** `OPEN`/`DONE` become
`NOT_STARTED`/`IN_PROGRESS`/`REVIEW`/`COMPLETED`. Reads normalize both
vocabularies (`normalizeTaskStatus`, never reading an unknown value as
completed); filters match both (`storedTaskStatuses`); new writes use the new
names. `npm run roles:backfill` now rewrites legacy task statuses too, after
deploy. The lifecycle is enforced by the server (`canMove`), not only offered
by the UI.

**Humans and agents on one model.** An AI agent is a `User` with role
`AI_AGENT`: it has skills and is assigned and measured on tasks; it has no
schedule and no attendance, and its profile lists its `AgentGrant`
capabilities instead.

**Activity feeds are the audit log.** Phase 1 wired audit logging into the
data layer; Phase 2 adds attendance, skills, schedules, checklist items,
comments and files to the audited models, and the employee and task feeds read
from it — there is no second activity table to drift.

**No composite score.** Attendance and delivery are computed and shown
separately, each with its definition on screen. The prompt allows an overall
score only if its weights are displayed; choosing weights is a founder
decision, so none is invented.

**Known limitation — file storage.** Task attachments use the existing
validated upload store (`lib/uploads.ts`), which writes to local disk. On
Vercel that disk is ephemeral, so attachments do not persist in production
until the S3-compatible store lands (ARCHITECTURE §5, P3). The `File` model
already has the shape that store needs.

**Replaced page.** `/team/[id]` was the parked scoring module's profile; it is
now the employee profile Phase 2 specifies. The scoring module stays parked.

---

## ADR-012 — Phase 3: the lead pipeline on the existing CRM

**Date:** 2026-09-26 · **Status:** accepted

**Standard stages as a template, not a rewrite.** The prompt's stages (New
Lead → Contacted → Qualified → Meeting → Proposal → Negotiation → Won / Lost)
are `STANDARD_STAGES` in `modules/leads/domain.ts`. Fresh databases and every
department created from now on get them. **Existing departments keep their
stages:** the seed never rewrites a department it finds (ADR-008), and
renaming stage keys under live leads is a migration on a populated table,
which is a founder decision (CLAUDE.md §12). Until that is decided, the
analytics funnel and the "contacted / qualified" counts, which read the
standard keys, show only departments on the template; everything else
(board, conversion, outreach, velocity per stage) works with any stages.

**Stage history is a table.** `LeadStageEvent` records every move, written in
the same transaction as the move itself. The funnel counts leads that
*entered* a stage, and velocity measures completed stays. Neither can be
derived from `Lead.stage`, which only knows the present.

**One-action conversion replaces the wizard hand-off.** Before, "convert"
opened the client wizard pre-filled from the lead and relied on a second POST
to link the two. It could half-finish. `convertLead` now creates the
ClientAccount, the Client (every lead field, the department answers copied by
key), the Project with its services, re-links the history, marks the lead Won
and optionally invites a client user, all in one transaction with an explicit
`LEAD_CONVERTED` audit entry. The prefill GET and link POST were removed with
their only callers. A lead can be converted from any stage except Lost
(reopen it first) and only once (409).

**Outreach is counted, not stored.** Every figure is a count of
`SalesActivity` rows by kind (METRICS). There are no counters to drift, which
is what makes "reconciles exactly" testable. The legacy generic types keep
counting as their nearest kind so pre-Phase-3 history is not lost.
`DEAL_CLOSED` is written by the system on the first win only and credited to
the lead's owner.

**A snooze is a note.** Postponing a follow-up used to log a `FOLLOW_UP`
activity, which would now inflate the follow-up count with work not done. It
writes a `NOTE`. That is a small, deliberate behaviour change.

**Transaction-aware audit.** The audit extension wrote each entry (and read
before-images) through the base client. Inside an interactive transaction
that deadlocked on SQLite and, on Postgres, would commit audit rows for
changes that then rolled back. Now `transaction()` in `lib/prisma.ts` runs the
work under an `AsyncLocalStorage` buffer. The extension pushes entries there
(without before-images, which would need an outside read), and they are written
after commit or dropped on rollback. The buffer lives on `globalThis`, like the
Prisma client, because Next can load a module more than once. A unit test
forbids interactive `prisma.$transaction` outside `lib/prisma.ts`.

**Duplicates warn, they don't block.** A new lead whose email, or normalized
name + last ten phone digits, matches an existing one returns 409 with the
match. The person can choose "Create anyway" (`allowDuplicate`). Import
reports duplicates and skips them unless told otherwise.

**The board pages by column.** 50 cards per stage, with totals from `groupBy`
and "load more" per column. The board stays fast at 1,000+ leads (120 ms
measured with 1,200+ in `leadtest`) without virtualizing the drag-and-drop.

**Alternatives rejected:** rewriting every department's stages on deploy
(silent change to live data); counters on `User` for outreach (drift, no
reconciliation); keeping the wizard path alongside the one-action convert (two
ways to do one thing, one of them non-atomic).

---

## ADR-013 — Phase 4: client management and projects

**Date:** 2026-09-27 · **Status:** accepted

**Projects extend the existing `Project` table; the retainer machinery stays
parked.** D4 marked retainer cycles "superseded by the P4 projects module".
The retainer system (workstreams, scored milestones, renewals, payment
cycles) is entangled with scoring: every milestone status change writes
score events. It is also founder-only, and its tables had no tenant key. So
Phase 4 keeps the `Project` row that lead conversion and tasks already use,
adds tenancy and the new lifecycle to it, and adds lean new models:
`ProjectStage`, `ProjectMilestone`, `ProjectMember`, `ProjectSkill` and
`ProjectComment`. The retainer `Module`/`Milestone` code is untouched and
parked. `/board` and `/my-tasks` stay behind its flag. `/projects` moves out
of the flag into the core product. The evaluation cron's close-out, payment
and renewal steps now run only while the retainer module is on, and close-out
only touches cycles that have retainer workstreams, so a Phase 4 project past
its deadline is never auto-closed or charged. The legacy planner pages and
their components were replaced (the parked module's own code is kept, per
D4, until the founder approves deleting it).

**Stage templates are copied, not referenced.** A service's template is
copied onto a project when the service is added. Editing a template changes
future projects only; work under way keeps its plan.

**Progress: one formula, weighted, rounded down.** Milestones count by their
weight (1–5), tasks count 1, and stages are the fallback. Rounding down means
100% only when everything is done. The formula is pure, documented, unit
tested, and re-checked over HTTP against the database. A second formula
(e.g. time-based) was rejected: two progress numbers disagree in front of a
client.

**Health: rules with reasons, not a score.** The legacy weighted score
needed ROAS and payment data that belong to parked modules. The Phase 4
health is three bands whose every trigger is named on screen.

**Who sees what.**
- The founder sees everything, including money.
- Managers run their departments' clients and projects, without money:
  prices, contract values and recurring revenue are founder-only, and so are
  client phone numbers (the standing leak-scan policy).
- Employees see a project only by being on it: as a member, its owner, or
  assigned one of its milestones. They move its work (stages, milestones,
  tasks, files, discussion) but not its shape.
- The clients list stays with the founder and managers. Employees reach their
  clients through projects.

**Credentials vault.**
- AES-256-GCM, with the key from the environment and rotation by key id.
- Each secret is bound to its record through associated data, so copying a
  sealed value elsewhere fails.
- `reveal` is a separate permission action from `read`.
- Every reveal is audited before the secret is returned. An audit failure
  means no reveal: unlike ordinary audit writes, this one is not
  best-effort.
- `secret` is redacted from audit entries, even in sealed form.
- Development falls back to a key derived from `NEXTAUTH_SECRET`. Production
  without `VAULT_KEY` refuses.

**Files: signed URLs over the existing store.** Access is derived from the
owner (task, client, project or contract), then a five-minute HMAC-signed
URL is issued. This mirrors S3 presigned URLs, so the bucket swap is local to
`lib/uploads.ts` and `/f/[id]`. The bucket itself is not chosen here: it
needs a provider and credentials (a founder decision), and until then files
live on the validated local store, which does not persist on Vercel.

**Alternatives rejected:**
- Reusing the retainer `Milestone`: scoring side effects, and no tenant key.
- Deleting the retainer module now: D4 says only after the replacement ships
  and the founder agrees.
- Storing progress on the project: a stored number drifts from its facts.

---

## ADR-014 — Phase 5: project assignment

**Date:** 2026-09-28 · **Status:** accepted

**Deterministic core, AI at the edge.** The score is a pure function of
recorded facts (skills and proficiency, capacity, open work, on-time
history, leave, deadlines), so it can be tested to the decimal, explained in
a sentence, and trusted when it's wrong for a known reason. AI does one job:
reading the brief for skills the services don't cover. It may only name
skills already in the taxonomy (everything else is discarded), it has an
8-second limit, and it fails safe to "no extra skills". There's no SDK:
the Anthropic Messages API is called over `fetch` behind `modules/ai`'s
interface, so the provider is configuration. With no key, the product is
fully functional.

**Roles are required skills.** A project needs one person per required
skill. One person may hold several roles, but every role carries a weekly
load (default 6 h), so a second role costs capacity. That spreads work to
specialists instead of piling it on one generalist. A first version counted
a person's load once per project, and the fixed-data test caught the web
lead absorbing UI/UX over the UI/UX specialist.

**Free capacity is measured after the role, for everyone.** The brief's
`1 − workloadRatio` is computed on the load a person would carry with the
role. A current holder's role is already in their load; a newcomer's is
added. Measuring "before" penalised whoever had just been accepted, and
flipped rankings the moment a founder confirmed. The browser check caught
this, and a unit test now pins it.

**Hard constraints are filters, not penalties.** Not holding the skill (at
2/5 or better), being on leave or inactive, and going over capacity remove a
candidate from the ranking. A role no one can fill is shown as a gap, with
the reason. The founder can still assign anyone active, and the dialog says
when that person doesn't meet the rules.

**Overrides are the signal.** An overridden recommendation keeps who was
recommended and who was chosen. For that skill, over 180 days, each choice
moves the chosen person up and the passed-over person down by 0.04 (capped
at ±0.12), and the explanation says so. It's a nudge, never an override of
the facts, and it's per skill.

**RECOMMEND by default; AUTO on request.** In RECOMMEND mode nothing
changes until the founder (or the project's department manager) confirms,
and the founder and the project owner are told a team is waiting. In AUTO
mode every role with a recommendation is accepted on creation; gaps remain
for a human. Every decision is audit-logged by the data layer.

**Rebalancing only suggests.** A morning sweep, a deadline change, or an
on-demand check can raise a "reassignment suggested" signal. It never moves
a role. Accepting a suggestion moves the role and tells the previous holder,
who stays on the team.

**Alternatives rejected:**
- A learned ranking model: it can't be explained or tested with fixed data,
  and there's too little history.
- Letting AI score candidates: it isn't reproducible, and it would put
  personal data in prompts for no gain.
- Assigning silently on imbalance: the brief forbids it.

## ADR-015 — Phase 6: the client portal and client–team messaging

**Date:** 2026-09-28 · **Status:** accepted

**Allow-list, not deny-list.** Portal data is built by serializers that
copy named fields (`modules/portal/views.ts`). Stripping internal fields
from full rows would leak the first new column someone forgets to strip.
Internal rows are also excluded in the query, so the serializer is a second
wall, not the only one.

**Visibility is a flag on the thing, defaulting to internal.** Updates,
comments and files carry INTERNAL/CLIENT; reports carry DRAFT/PUBLISHED.
Nothing becomes visible to a client without a deliberate choice by the
founder or a manager (employees can't share). Internal notes stay in the
same tables as shared ones, so the team works in one place.

**Not found, never forbidden.** Another account's id returns 404 (API) or
the "not available" view (page), so a client can't learn which ids exist.
The portal page answers 200 with that view rather than a 404 status because
the portal's loading boundary streams the response; the harness checks the
content, not only the status.

**Invite-only, one account per login.** No sign-up route exists. The
invitation token is shown once (and emailed if SMTP is set), stored only as
a hash, expires in 7 days, and is claimed with a conditional update inside
the transaction that creates the login, so a replayed or raced link fails.
The public accept route is rate-limited. Owners can invite only MEMBERs;
new owners are added by the founder or a manager.

**The founder channel is structural.** The FOUNDER thread's visibility is
decided in code (`canSeeThread`: founders only), not by a permissions-matrix
scope, so widening a manager's `message` scope can never open it.

**Polling, not sockets.** A 15-second poll is enough for client messaging,
works on serverless hosting, and needs no new infrastructure. The model
(threads, messages, read markers) doesn't change if we add real-time
delivery later.

**Invoices through one seam.** The portal's invoices page reads
`invoicesForAccount()`, which returns nothing until Phase 7 fills it. The
page, API, owner-only rule and empty state are final.

**Alternatives rejected:**
- A separate client app or database: two systems stapled together.
- Client self-registration with approval: the brief says invite-only.
- Letting employees share with clients directly: sharing is a
  management decision in the brief, and the flag makes it auditable.

## ADR-016 — Phase 7: invoices, payments and money

**Date:** 2026-09-28 · **Status:** accepted

**Integer cents, rounded once per line.** Amounts are integers in minor
units; quantities in thousandths. A line is rounded half away from zero,
once; the total is the sum of rounded lines, so the PDF, the portal and the
overview always add up. Input goes from text to integers without a float;
large products use BigInt. The legacy `Client.monthlyBudget` and
`ClientService.price` stay whole units and are converted (×100) at the edge.

**Numbers are taken when sent, not when drafted.** Drafts come and go; an
issued number never does. The organization row holds the next number and an
atomic increment inside the send transaction takes it, so numbers are
sequential and unique per organization with no gaps, even under
concurrency (tested with simultaneous sends). A voided invoice keeps its
number. The next number isn't editable.

**Frozen once sent.** A sent invoice's lines, amounts and bill-to details
don't change; to correct one, void it and issue another. That keeps the
emailed PDF and the portal identical to the record.

**Status is derived, then stored.** One pure rule (`deriveStatus`) decides
SENT / PARTIALLY_PAID / PAID / OVERDUE from the money and the date, and every
write stores its result in the same transaction. Overdue beats partially
paid (money is late). The morning job applies the date part and notifies
once (stamped).

**Payments are idempotent and immutable.** A unique
`(organizationId, idempotencyKey)` makes retries and double clicks record
once; the insert and the invoice's paid total move together, guarded by the
paid total that was read. Over-payment is refused rather than turned into
credit (credits are a later decision). A mistaken payment is reversed —
kept, with who and why — never deleted.

**Revenue is money received.** The overview counts payments, not invoices,
as revenue; revenue by service allocates each payment across its invoice's
services by largest remainder so every breakdown sums exactly to the total.
Pending, overdue and outstanding are balances today. Figures are in the
organization's currency; other currencies are reported, never converted.

**PDF with pdf-lib.** Pure JavaScript, no native dependencies and no fonts
to ship (the standard Helvetica faces), so it runs on serverless. Rendered on
demand from the frozen record, so there is no stored copy to drift.
Characters outside the fonts' encoding fall back safely.

**Stripe behind a seam, off by default.** Checkout Sessions and a verified
webhook, over REST with `fetch` (no SDK). Live charging needs
`STRIPE_ENABLED=true` and both keys, so a key alone can't start taking money.
A payment is recorded only from the signed webhook, never from the redirect.

**Money is the founder's.** Only FOUNDER reads or writes billing; managers
and employees see none of it (continuing the Phase 4 billing summary rule).
A client reads its own account's invoices, and only its OWNER.

**Alternatives rejected:**
- Floats or decimals-as-strings in the database: floats round wrongly;
  string decimals push arithmetic into every caller.
- Numbering on draft creation: deleted drafts would leave gaps.
- A stored PDF per invoice: two sources of truth.
- Recording a payment on Stripe's success redirect: forgeable and unreliable.


## ADR-017 — Retheme: "Obsidian & Gold" (dark) → "Forest & Mint" (light)

**Date:** 2026-09-28 · **Status:** accepted (founder direction)

**Decision.** The whole product (team app, command center, client portal,
emails, invoice PDF, icons) moves from the dark Obsidian & Gold theme to the
light Forest & Mint palette the founder supplied (`forest-mint-theme.css`,
sampled from a reference dashboard). The palette's hex values are taken
exactly and are not tuned. No behaviour changes; this is presentation only.

**Rationale.** Brand direction: the founder wants a premium, luxurious,
eye-catching look built on a single deep green, with a light, calm canvas
closer to the reference dashboard.

**How.**
- **One source of values.** The palette is defined once in
  `app/globals.css` as RGB triples; Tailwind reads role variables through
  `rgb(var(--x) / <alpha-value>)`, so opacity modifiers still work. Token
  class names are kept (`canvas`, `surface`, `ink`, `brand`, `line`, `data`…),
  so call sites didn't churn. The raw hexes are copied only where CSS
  variables can't reach (charts, emails, PDF, icons), and a test checks they
  match.
- **Dark panels re-scope, not re-class.** `.surface-dark` (sidebar, hero
  cards, report mastheads) redefines the role variables. Text turns white,
  muted text turns neutral gray, and the accent turns white, so no light
  green is used as text even on the deep panel.
- **Muted text became a token.** On white, `ink` at 40–60% opacity falls to
  about 2.5–4.4:1. About 660 such usages became `ink-muted` (gray-600,
  5.8:1), and about 100 at 65–75% became `ink-2`. Disabled and placeholder
  states stay faint on purpose.
- **Semantic text tokens.** `success-ink` (brand green) replaces green-600
  text. Info and warning text is ink, with the hue kept on tints, borders
  and icons, because teal and `#D97706` fail as text on white.

**The founder's two rules, enforced by tests** (`tests/design-tokens.test.ts`):
1. **Negative data is gray, never red.** Falling trends, negative deltas and
   low scores use gray-600. Red is kept for destructive actions, errors and
   alert *statuses* (an "Overdue" badge, a late date). Those are states that
   need action, not negative numbers. A number is never red.
2. **Green-600 and lighter are never body text** (nor teal, nor the data
   series). This covers class strings and the inline styles in emails, error
   pages and the PDF. Icons may carry the hue.

Also tested:
- the palette's values, to the digit;
- no stock Tailwind colors or off-palette shades;
- no leftover Obsidian & Gold hex.

**Consequences.**
- Stored avatar colors from the old palette are mapped to the new one at
  display time; no data is rewritten.
- The legacy retainer "Collections" amounts are ink, not red.
- A "Critical" score band is gray.

**Alternatives rejected:**
- Keeping ink opacities for muted text: fails AA on white.
- A separate dark-panel class set: hundreds of duplicated classes.
- Adjusting the palette for contrast: the founder fixed the values, so
  contrast is solved by *which* token is used for text.

## ADR-018 — Phase 8: the Command Center, client results, monthly reports, notifications

**Date:** 2026-09-29 · **Status:** accepted

**Like-for-like comparisons.** Every Command Center figure is compared with
the same number of days immediately before, not "last month". A month to
date against a full month always reads as a fall; the same span doesn't.
A rate's change is in points, and a percent from zero isn't shown.

**Aggregate in one call, cache, warm.** The Command Center is one query batch
per period (about 200 ms on the seeded data), cached five minutes in
`AnalyticsSnapshot` and warmed each morning. A true materialized view per
figure would be premature at this scale. The cache is the "materialized where
needed" seam, and a snapshot table can move to a warehouse later without
changing the API. Team figures reuse the team module's functions, so the
Command Center and the Team pages can never disagree.

**Client results: one table, integer values, derived rates.** A
`MetricValue` per client, metric, source and month. Money is in cents,
decimals in thousandths, and rates are always derived (a stored CTR could
disagree with its clicks). Sources don't overwrite each other; reads resolve
them by precedence: a person's entry, then a live sync, then demo data. So a
correction is never lost to the next sync, and clearing it restores the
synced figure.

**Adapters now, live sync later, demo data labelled.** All five providers
implement one interface. They build OAuth consent URLs, but live sync is off
behind `INTEGRATIONS_LIVE` until each provider's API calls are built and
tested against a real account (the brief: "feature-flagged for later"). The
mock adapter is deterministic and exists for demos and development. Its rows
carry source MOCK and every screen and report says "demo data". Mock sync
cannot run in production.

**Reports are reviewed, and AI is fenced.** A generated report is a frozen
snapshot, not a live query, so what was reviewed is what the client reads. It
is a draft until a founder or the department's manager approves it; approval
is the only path to the portal. The AI summary sees only the facts, and a
draft that quotes any number not in them is discarded for the deterministic
summary. A report never states a figure we didn't compute. With no AI
configured, reports still generate.

**One notify(), three rules.** Rather than trusting every emitter, `notify()`
enforces audience (by role, per category), preference (off / in the app /
in the app and email, with minimums for billing and announcements) and
channel. Email is sent inline with a bound and retried by the morning job.
Hobby-plan crons are daily, and a queue would be new infrastructure for no gain
at this volume. The email sender is loaded lazily, so notifying never pulls
server-only mail code into modules that merely import `notify`.

**Resend, keeping SMTP.** Resend's HTTP API when `RESEND_API_KEY` is set,
SMTP otherwise, nothing when neither. The base URL is overridable so the
notification suite can assert real deliveries against a local stand-in.

**Also fixed:** signed downloads built `Content-Disposition` from the raw file
name, and any non-Latin-1 character (an em dash, "Menú") made the download a
500. All download routes now send an RFC 6266 header: an ASCII fallback plus
the exact UTF-8 name.

**Alternatives rejected:**
- A table per provider's metrics: every consumer would need to know every
  provider.
- Publishing generated reports automatically: the brief requires human review.
- A job queue for email: new infrastructure with no need at this volume.

## ADR-019 — Phase 9: AI employees, the agent framework and automations

**Date:** 2026-09-29 · **Status:** accepted

**An agent is a user plus one capability.** Agents were already `AI_AGENT`
users with explicit grants (Phase 1). Phase 9 adds an `AgentProfile` naming
one capability: a code module declaring what it works on, the tools it may
call, its default limits and a `run` function. Adding an agent means adding
a capability file and a registry line. Hiring creates the user and grants
exactly the permissions its tools need, recorded as the founder's decision.
A unit test proves every capability's grants are ones the matrix offers
agents. Demonstrated by *Client Check-in*, added in its own commit.

**Code decides; the model writes.** Capabilities call typed tools directly;
the model is never handed tools or allowed to choose actions. It is asked for
text (a rationale, a summary, a draft) that is parsed and validated against a
schema before use; anything else is discarded for the deterministic path. So
prompt injection can change a sentence of prose at most, never an action.
Every capability works with AI off, over budget, or failing.

**Tools enforce permissions like people's code does.** Each tool names its
permission and checks the agent's grant against the target's organization
and department on every call. Runs execute inside `actingAs(agent)`, so the
tenancy extension scopes every query to the agent's organization and the
audit extension records the agent as the actor. The actor stores are
process-wide (`globalThis`), like the Prisma client and the audit buffer.
Next loads a module once per bundle, and a per-bundle store attributed an
agent's writes to the person whose request queued the run. The harness
caught this.

**Consequential means proposed.** Sending to a client, marking a lead won or
lost, creating an invoice and publishing a report are tools that only create
an `ApprovalRequest`. Approving executes it *as the approver*, through the
same functions people use: `moveLeadStage`, `post`, `saveDraft`,
`approveAndPublish`. So the approver's permissions apply and the audit log
names them. Founders decide anything. Managers decide for their departments.
Invoices are founder-only. Decisions are claimed conditionally, so each is
made once.

**The table is the queue.** `AgentRun` rows are claimed by a conditional
update (QUEUED → RUNNING with a lease). They start in-process the moment
they're queued, and `/api/cron/agents` plus the morning job drain what's
left: runs deferred by a rate limit, runs a serverless host froze, stale
leases (retried up to three times). A queue product (Inngest, BullMQ) would
be new infrastructure for a volume this doesn't have. The seam is
`runner.ts`.

**Limits.** A rolling-hour rate limit defers runs rather than dropping them.
A monthly budget in micro-dollars stops model calls, and work continues on
rules. Cost is recorded per call from token usage and a price table
(overridable).

**Safety.** Before any model call: contact details are replaced, known secret
shapes (API keys, tokens, sealed vault values) are stripped, and prompts are
capped. External content is wrapped as untrusted data with a standing
instruction and scanned for instruction-like text, which is reported on the
run. The fetcher reaches only public http(s) addresses on standard ports: it
re-checks every redirect hop, resolves DNS to refuse private ranges, and caps
time and size.

**Automations are rules, emitted where the moment happens.** Four triggers
(lead created, stage changed, deadline near, report due) and three actions
(give an agent the work, notify, create a task). Conditions are a strict
allow-list of keys. Each rule fires once per occasion (`AutomationFiring`,
unique per rule and subject key). Emitting never fails the caller.

**Alternatives rejected:**
- Letting the model call tools (function calling): hands actions to text we
  can't trust, and makes runs non-repeatable.
- A job-queue service: infrastructure without the load to justify it.
- Separate "agent API" endpoints: agents would bypass the permission and
  audit paths people use.
- Auto-executing consequential actions above a confidence threshold: the
  brief requires human approval.
