# Advertise X — Architecture

*Living document. Established in Phase 0 at `b50016c`; updated at the end of
Phase 1 to separate what is **built** from what is still **target**. Every
structural change lands here with an ADR reference. Subject to
`docs/REQUIREMENTS.md` when it arrives — that document wins.*

## 1. Shape of the system

One Next.js application, one Postgres database (SQLite locally), one design
system, three experiences delivered as route groups. **Built in Phase 1:**

```
app/
  (auth)/      login · change-password                       no shell
  (admin)/     founder configuration + ops logs              StaffLayout, FOUNDER|MANAGER only
  (team)/      the shared staff surface                      StaffLayout, all staff
  (client)/    /portal — the restaurant client portal        ClientShell, CLIENT only
  api/         83 route handlers, every one gated            requireApi / requireAdminApi / cron secret
  design-system/  dev-only showcase                           404 in production
```

Route groups are URL-transparent: no link or bookmark changed. The staff
**experience** follows the viewer's role, not the URL — FOUNDER and MANAGER
get the command center, EMPLOYEE the team shell (task-first rail, "My work")
— so a founder opening the shared pipeline is still in the command center.
The client portal is a separate shell: slim top bar, the restaurant's own
name, no internal vocabulary, sections that arrive later shown as "Soon".

## 2. Module map

Modules migrate **incrementally** (ADR-007): new foundation code is born in
`modules/`; existing code moves when a phase touches it, one move per commit,
behaviour unchanged, gate green. **Built:**

```
config/permissions.ts   roles, legacy-role mapping, the matrix           (Phase 1)
modules/
  rbac/       authorize() (pure) · principalFor/requireApi/page guards   (Phase 1)
  tenancy/    scopeArgs() (pure) · request context · Prisma extension    (Phase 1)
  audit/      buildAuditEntry() (pure) · Prisma extension                (Phase 1)
```

**Target** (moved when their phase touches them):

```
  users/ teams/ leads/ fields/ clients/ tasks/ activity/ analytics/
  notifications/ reports/ billing/ messaging/ integrations/ ai/ files/ jobs/
```

Module layout per CLAUDE.md §5 (`domain/ data/ server/ ui/`). Phase 1 split
three existing modules along that line where the split was forced (ADR-009):
`lib/fields` (pure) / `lib/fields-data` (server), `lib/notification-types` /
`lib/notifications`, `lib/audit-actions` / `lib/audit`.

## 3. Multi-tenancy (ADR-005, ADR-009) — built

- Shared schema. `Organization` is the SaaS tenant; **Advertise X is
  organization #1** (slug `advertisex`). `ClientAccount` is a restaurant's
  portal tenant inside an organization; a CLIENT login belongs to exactly one.
- Tenancy keys: `organizationId` on `User`, `Department`, `Client`,
  `ClientAccount`, `AgentGrant`, `AuditLog`; `clientAccountId` on `User`
  (CLIENT logins) and `Client`. Nullable, indexed, backfilled by the seed.
- **The wall is the data layer.** The shared Prisma client carries a tenancy
  extension: inside a signed-in request every query on a tenant-owned model is
  scoped to the caller's organization — roots directly, department-owned rows
  through their department — and creates are stamped. No handler can forget
  it. Proven by `scripts/tenanttest.mjs` (a planted second organization is
  invisible across 24 checks; with the wall disabled, 12 fail).
- Intra-organization scoping (department, assignment, ownership) stays where
  it was: `departmentScope(viewer)` and the handlers' own filters.
- **Target:** Postgres Row-Level Security as the second wall; jobs carrying an
  organization context; `Settings` per organization.

## 4. Authorization — built

- Roles: `FOUNDER`, `MANAGER`, `EMPLOYEE`, `CLIENT`, `AI_AGENT`, defined with
  the matrix in `config/permissions.ts`. Legacy strings (`ADMIN`,
  `SUPPORT_ADMIN`, `MEMBER`) are *read* as their new names by
  `normalizeRole()` until `npm run roles:backfill` rewrites them after deploy
  (ADR-008, expand then contract). Anything unrecognised → `null` → deny.
- The matrix: resource × action × role → scope (`all`, `department`,
  `assigned`, `own`, `client-own`, `grant`). No cell, no access.
- `authorize(principal, action, resource, target?)` is pure; the principal is
  read from the database on every request (never trusted from the cookie).
- **Every route handler** opens with `requireApi(action, resource)` (or
  `requireAdminApi()`, or the cron bearer secret) before any query —
  enforced structurally by `tests/route-guards.test.ts`.
- **Pages:** middleware keeps CLIENT inside `/portal`, staff out of it, and
  staff off screens their role may not open; `StaffLayout`,
  `requirePage()` and `requireClientPage()` repeat each check on the server.
- AI agents are users of type `AI_AGENT`; the role holds nothing by itself.
  `grant` cells allow an action only with an `AgentGrant` row naming it. Agents
  cannot sign in with a password.
- The serializer layer (`lib/serializers/`) remains the egress half:
  authorize decides *may you act*, serializers decide *what leaves*.

## 5. Contracts, jobs, AI, integrations, audit, files

- **Audit — built (ADR-009):** every create/update/delete of a business entity
  writes `AuditLog { actorId, actorType, organizationId, entityType, entityId,
  action (RECORD_*), beforeJson/afterJson (the diff), createdAt }` from the
  data layer. The hand-written entries (`lib/audit.ts`) remain for the
  judgement calls and are what the audit screen shows by default;
  `?action=RECORDS` lists the full data trail.
- **Observability — built:** `lib/logger.ts` (structured JSON lines in
  production, readable in development); `SystemError` rows surfaced at
  `/admin/errors` are the Sentry-equivalent until an external collector is
  earned; route error boundaries per shell (the client one without internal
  jargon); designed `global-error` and `not-found` pages.
- **Contracts (target):** Zod at every boundary (today: most routes);
  one error envelope `{ error, fields? }`; pagination on all lists (added per
  module as extracted); idempotency keys on money mutations (P4).
- **Jobs (target):** `jobs/` interface over Vercel cron now, Inngest when
  retries/fan-out are needed (ADR-004).
- **AI / integrations (target, P5):** `modules/ai` (`complete`, `embed`,
  `runAgentTask`) and `modules/integrations/<provider>` behind one interface;
  mock adapters first.
- **Files (target, P3):** S3-compatible store, signed URLs, tenant + client
  scope, `internal|client` visibility.

## 6. Migrations and deploys — built (ADR-003, ADR-008)

Versioned migrations only: `prisma/migrations/` holds the baseline (production's
state as `db push` left it) and the additive Phase 1 migrations;
`prisma/migrations-legacy/` keeps the never-deployed BWM-era files for history.
`vercel-build` runs `scripts/migrate-deploy.mjs`, which baselines a ledger-less
database exactly once — marked applied, never executed, and refused without
`BASELINE_BACKUP_CONFIRMED=1` — then runs `prisma migrate deploy`.

## 7. What deliberately does NOT change (continuity, ADR-001)

Next.js 14 App Router + TS strict · Tailwind + hand-built primitives
(retokened, not replaced by shadcn) · Prisma · NextAuth credentials · npm ·
root-level `app/` (modules live under `modules/`; a `src/` move is cosmetic
risk with no payoff now) · the HTTP harness suite, now including
`shelltest` (every role's shell and every cross-shell door) and `tenanttest`
(organization isolation).
