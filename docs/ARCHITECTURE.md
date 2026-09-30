# Advertise X — Architecture

*Living document. Established in Phase 0 at `b50016c`; final for launch at
Phase 10 — everything marked **built** is in production code and covered by a
test or harness; what remains **target** is stated as such. Every structural
change lands here with an ADR reference.*

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
  attendance/ domain (pure: hours, breaks, late, early, absence, month) · server (time clock)   (Phase 2)
  tasks/      domain (pure: lifecycle, deadlines, on-time, workload) · server (access) · deadlines job (Phase 2)
  team/       directory, performance, attendance roll-ups, activity feed (from the audit log)  (Phase 2)
  leads/      domain (pure: standard stages, sources, filters, tags, velocity) · csv (pure: parse,
              validate, duplicates, formula-safe export) · server (filters → where) · convert   (Phase 3)
  outreach/   domain (pure: kinds, company-calendar buckets, reconciling rollups)              (Phase 3)
  services/   catalog (pure: the 11 services, prices, cadences, stage templates, skills)       (Phase 4)
  projects/   domain (pure: statuses, progress, schedule, stages, upcoming) · server (scope,
              the one create path, batched summaries, team notifications) · jobs (delayed
              detection, deadline warnings) · activity (audit log → sentences)                 (Phase 4)
  clients/    health (pure rules) · overview (batched card/profile state) · server · contracts (Phase 4)
  vault/      cipher (pure AES-256-GCM, record-bound) · keys (env, rotation) · server
              (server-only) · credentials (masked lists, audited reveal)                      (Phase 4)
  files/      signing (pure HMAC signed URLs) · server (server-only: owner-derived access)      (Phase 4)
  assignment/ domain (pure: requirements, scoring, constraints, explanations, team plan,
              rebalancing) · server (real inputs, stored recommendations, decisions,
              AUTO mode, rebalance sweep)                                                     (Phase 5)
  ai/         provider (the interface) · anthropic (Messages API over fetch) · index
              (server-only: provider from env, null when off) · skills (brief → taxonomy)   (Phase 5)
              · pricing (µ$ per call) · fake (dev/test stand-in model)                        (Phase 9)
  ai/agents/  capability (the contract) · registry (every capability) · capabilities/*
              · grants (pure: tool → permission) · safety (pure: PII, secrets, untrusted
              content, SSRF) · scoring (pure: lead qualification) · triggers (pure:
              automation vocabulary) · queue (enqueue; loads the worker on demand) · tools · runner · approvals · automations · rules
              · server (server-only)                                                          (Phase 9)
  portal/     views (pure: the allow-list serializers — stage tracker, milestones, shared
              updates, report grouping, notification preferences) · server (server-only:
              account scoping, projects, reports, invites) · invite-email                     (Phase 6)
  messages/   server (server-only: who may see a thread, TEAM/FOUNDER threads, unread,
              receipts, notifications)                                                        (Phase 6)
  billing/    money (pure: integer cents, parsing, rounding, allocation) · domain (pure:
              statuses, totals, lifecycle rules, MRR, the overview arithmetic) · views
              (allow-list serializers) · server (access, drafts) · lifecycle (send,
              payments, reversals, void, overdue sweep) · overview · pdf · email · portal (Phase 7)
  integrations/payments/  provider (the interface) · stripe (REST over fetch, webhook
              signature) · index (server-only: provider from env, off by default)          (Phase 7)
  notifications/  catalog (pure: every type's category, audience, default level,
              minimum; preferences; the founder's event list) · announcements (server)     (Phase 8)
  analytics/  domain (pure: periods, comparison windows, buckets, deltas, retention,
              aging) · server (the Command Center, cached; retention; receivables)          (Phase 8)
  client-analytics/  metrics (pure: channels, units, derived rates, precedence) · server
              (results, manual entry, sync)                                                 (Phase 8)
  integrations/analytics/  provider (the interface) · mock (deterministic demo data) ·
              live (five adapters: OAuth URLs; sync behind INTEGRATIONS_LIVE) · index      (Phase 8)
  monthly-reports/  domain (pure: snapshot, highlights, template summary, AI guard) · pdf
              · server (generate, revise, approve and publish, the monthly job)            (Phase 8)
```

**Notifications (Phase 8).** Every emitter calls `notify()` (lib/notifications),
which enforces three things. **Audience:** a type reaches only the roles its
category allows (billing never reaches staff below the founder; team work
never reaches a client). **Preference:** off, in the app, or in the app and by
email, per category, with minimums for billing and announcements.
**Channel:** email is sent at once (bounded), recorded on the row, and retried
by the morning job. The sender (Resend's API when `RESEND_API_KEY` is set,
else SMTP) is loaded lazily, only when an email is sent. An optional daily
digest runs in the morning job. The notification center (`/notifications`,
`/portal/notifications`) and the bell read the same rows.

**Command Center and analytics (Phase 8).** One aggregated call per period
(`/api/command`) returns leads, outreach, revenue, projects and team figures
with the comparison period. It is computed in about 200 ms on the seeded data
and cached for five minutes in `AnalyticsSnapshot`, which is warmed each
morning. The team section reuses the team module's performance and attendance
functions, so the numbers agree with those pages. Founder-only. The analytics
hub (`/analytics`) links the existing department-scoped pages and adds
retention and receivables.

**Client results and integrations (Phase 8).** Results are `MetricValue` rows,
per client, metric, source and month. Every screen and report reads resolved
values (manual beats sync beats demo) and derives rates, so nothing
downstream knows a provider. Five adapters implement one interface. The
mock writes demo data (labelled everywhere). The live adapters build OAuth
links, and their sync stays off behind `INTEGRATIONS_LIVE` until the API calls
are built. Manual entry is the path today.

**Monthly reports (Phase 8).** A report is a frozen snapshot (results, project
progress, highlights), a summary (AI when configured and the draft passes the
number guard, else a template), and a branded PDF rendered from the snapshot.
It is created as a draft that needs review. Reviewers are notified, can edit
the summary (the PDF is re-rendered), and approve it. Approval is the only
way a generated report is published to the portal. The monthly job drafts last
month's reports in the first five days of a month, idempotently.

**Billing (Phase 7).** Money is integer cents end to end (docs/METRICS.md →
"Money"). An invoice is a draft until sent; sending takes the organization's
next number with an atomic increment in the same transaction as the status
change, so numbers are sequential, unique and gap-free. Every state change is
a conditional update on the state that was read (optimistic concurrency), so
racing requests can't both succeed. Payments are idempotent by
`(organizationId, idempotencyKey)` — the UI sends one key per payment dialog,
Stripe events use their event id — and never deleted: a mistake is reversed
and kept. The overdue sweep runs in the morning job and on demand. The
overview's arithmetic is pure (`buildOverview`) and `billingtest` recomputes
it from the database. PDFs are rendered server-side with pdf-lib (standard
fonts, nothing to install); the portal reads through `invoicesForAccount`
and `invoiceForClient` (owners only, never drafts, 404 for anything else).
Money is the founder's: no role below FOUNDER can read billing.

**Payments provider (Phase 7).** `modules/integrations/payments` is the only
place a payment provider is called. Stripe is prepared (Checkout Sessions
over REST, webhook signature verification with a 5-minute replay window) and
off unless `STRIPE_ENABLED=true` with both keys. The webhook route is public
(its signature is the credential), returns 404 when disabled, and names the
organization explicitly on every query, since there is no session to scope
by.

**Client portal (Phase 6).** A client login is created only by accepting an
invitation (`ClientInvite`: a 24-byte token, stored as its sha256, 7 days,
single use, claimed atomically), and belongs to exactly one `ClientAccount`.
Everything the portal shows passes through `modules/portal/views.ts`, which
copies named fields into new objects — an allow-list, so a field added to a
table later can't reach a client by accident. Internal content is excluded
at the query (updates and comments are loaded `visibility: CLIENT` only;
files only when shared; reports only when published), and the portal never
calls staff APIs: those refuse CLIENT outright. Another account's project,
report, file or thread is "not found", never "forbidden". Owners see
billing and invite colleagues as MEMBERs; members see projects, reports and
messages. `npm run portaltest` proves isolation and the absence of internal
content on every portal page and API.

**Messaging (Phase 6).** Each client has a TEAM thread (the founder, and
staff whose `message` permission covers the client: the department's
manager, assigned employees) and a private FOUNDER thread (founders only —
checked in `canSeeThread`, not in the matrix, so no scope rule can widen
it). Attachments are `File` rows owned by the message, served by the same
signed URLs. Unread counts and "Seen" receipts come from `ThreadRead`;
notifications respect each client user's preferences. The inbox polls every
15 seconds; real-time delivery can replace polling without changing the
model.

**AI (Phase 5).** `modules/ai` is the only place a model is called. The
provider is configuration (`ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_ENABLED`);
with none set, `aiProvider()` is null and every feature takes its
deterministic path. Today one feature uses it: reading a project brief for
required skills, constrained to the organization's taxonomy (anything else
the model says is dropped), with an 8-second limit and fail-safe to none.
Assignment scoring is deterministic and never calls a model.

**AI employees (Phase 9, ADR-019).** An agent is an `AI_AGENT` user with an
`AgentProfile` naming one *capability* (`modules/ai/agents/capabilities/*`).
A capability declares what it works on, the typed tools it may call and its
default limits, and a `run` that is plain code. The model only writes text
(validated before use); code decides every action. Each tool names the
permission it needs, and the agent must hold that `AgentGrant`, checked with
the target's organization and department on every call.

Runs are rows (`AgentRun`) and the table is the queue. The worker starts
in-process as soon as a run is queued, and `/api/cron/agents` plus the
morning job drain anything deferred or stranded. A run executes inside
`actingAs(agent)`, so tenancy scoping and the data-layer audit treat the
agent as the actor. Every tool call is also an `AgentStep` and an
`AGENT_ACTION` audit row with its inputs and outputs. Each model call adds
tokens and micro-dollars to the run, and a monthly budget turns the model off
(the rules path continues).

The four consequential tools only *propose*: an `ApprovalRequest`, decided in
`/approvals` and executed as the approver through the same code people use.
Automations (`AutomationRule`) are emitted by the code that owns each moment:
lead creation, `moveLeadStage`, the morning deadline sweep and the monthly
report job. A rule fires once per occasion (`AutomationFiring`).

Adding an agent means adding a capability file and one registry line: the
runner, tools, approvals, automations, hiring (which grants exactly what the
tools need) and the UI all read the definition.

**Credentials vault (Phase 4).** Secrets are sealed with AES-256-GCM under
`VAULT_KEY` (rotation via `VAULT_KEY_PREVIOUS`), bound to the credential's
id as associated data, and redacted from the audit log. Lists always return a
fixed mask; the secret leaves the server only through `POST
/api/credentials/[id]/reveal`, which writes its `CREDENTIAL_REVEALED` audit
entry *before* returning and fails closed if it can't. The vault and file
modules are `server-only`; a unit test walks the import graph so no client
component can reach them, and `npm run bundlescan` checks the built bundles.

**Files (Phase 4).** A file belongs to one task, client, project or contract,
and access is derived from that owner on every request. Bytes are served only
through `/f/[id]`, by a signed URL (HMAC over id, expiry and disposition, five
minutes) issued after the access check — the contract of an S3 presigned URL,
so moving storage to a bucket changes where the URL points, not who gets one.
Storage today is the validated local store (`lib/uploads.ts`).

**Transactions and audit (Phase 3).** Multi-entity writes use
`transaction()` from `lib/prisma.ts`, never an interactive `prisma.$transaction`
directly (a unit test enforces this). Inside it the audit extension buffers
its entries in an `AsyncLocalStorage` and `transaction()` writes them after
commit; a rollback drops them. Writing them mid-transaction through the base
client deadlocked on SQLite and would have committed audit rows for
rolled-back changes on Postgres (ADR-012).

**Target** (moved when their phase touches them):

```
  users/ leads/ fields/ clients/ activity/ analytics/
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
- **Contracts — built:** Zod at every route boundary (`.strict()` where a
  body is spread into a write); one error envelope `{ error, fields? }`;
  paginated lists; idempotency keys on money (payments) and compare-and-set
  updates on state (invoices, approvals, agent runs).
- **Jobs — built:** Vercel cron (daily on Hobby) calling `/api/cron/*` with a
  bearer secret. Every job is idempotent, stamps a `JobRun` row with its own
  staleness window (`lib/ops.ts`), and a failure notifies the founders the
  same day. The agent queue is its own table, drained in-process and by
  `/api/cron/agents` (ADR-019). A queue service stays deferred (ADR-004).
- **AI / integrations — built:** `modules/ai` (provider-agnostic; Anthropic
  over fetch with retry; a deterministic stand-in for tests) and
  `modules/ai/agents` (Phase 9); `modules/integrations/<provider>` adapters
  behind one interface, live sync behind `INTEGRATIONS_LIVE`. Outgoing calls
  retry transient failures with backoff (`lib/retry.ts`).
- **Files — built (Phase 10, ADR-020):** `lib/storage.ts` — an S3-compatible
  driver (SigV4 via `aws4fetch`) for production and a local-disk driver for
  development or a self-hosted server. Production without a configured store
  refuses uploads rather than writing to a disk that vanishes. Names are
  server-generated; access is derived from the owning record; downloads go
  through short-lived signed links with `nosniff` and a sandbox CSP. Uploads
  must match their declared type's signature.

## 5a. Security at the edge — built (Phase 10, ADR-020)

- **Headers (`middleware.ts`, `lib/security-headers.ts`):** every page gets a
  per-request nonce CSP (`script-src 'self' 'nonce-…' 'strict-dynamic'`, no
  inline scripts, no eval in production), `frame-ancestors 'none'` and
  `X-Frame-Options: DENY`; every response gets `nosniff`, a referrer policy, a
  permissions policy, COOP, and HSTS when served over HTTPS. The root layout
  renders per request so each page carries its own nonce.
- **The first wall:** the same middleware keeps the protected-path list,
  redirects signed-out visitors to `/login` with a same-origin callback
  (`safeCallbackPath`), and keeps each role in its own shell.
- **Sessions:** a JWT is only a claim. `getCurrentUser()` re-reads the account
  on every request — a deactivation, demotion or password change takes effect
  at once; a password change ends every other session
  (`User.passwordChangedAt` vs the token's `pwv`). A token whose account can
  no longer be used is sent to `/session-ended`, which clears it.
- **Rate limits (`lib/rate-limit.ts`):** sign-in, invitation acceptance,
  password change, vault reveal, uploads, messages, invitations and search.
  In-process per instance; swapping in Redis is a drop-in change.
- **Push and fetch SSRF:** push endpoints must be the browsers' push services;
  the research agent's fetcher reaches only public HTTP(S) addresses.

## 5b. Performance — measured (Phase 10)

- Queries per request measured with `PRISMA_QUERY_LOG=1` (docs/RUNBOOK.md):
  related rows are batched (`IN` / `GROUP BY`), no N+1. The settings row is
  memoised process-wide for 5 s and invalidated on save.
- Every foreign key is indexed (tested by a schema scan in the Phase 10 audit).
- Charts are code-split (`next/dynamic`) out of the pages that don't show them
  first; the Command Center is cached for 5 minutes and warmed each morning.
- Lighthouse on the staging build: 99–100 desktop on every core screen;
  91–100 mobile (lab throttling). Report: `docs/phases/PHASE_10_REPORT.md`.

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
