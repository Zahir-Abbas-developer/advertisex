# Advertise X — Target Architecture

*Living document. Established in Phase 0 at `b50016c`; every structural change
lands here with an ADR reference. Subject to `docs/REQUIREMENTS.md` when it
arrives — that document wins.*

## 1. Shape of the system

One Next.js application, one Postgres database, one design system, three
experiences delivered as route groups:

```
app/
  (auth)/      login · accept-invite · change-password · verify
  (admin)/     Founder/Manager command center  — dense, analytical
  (team)/      Employee + AI-agent operating surface — task-first
  (client)/    Restaurant client portal — simplified, zero internal jargon
```

The three experiences share tokens, components, auth, and the data model.
They differ in information architecture and density only (CLAUDE.md §7).

## 2. Module map

Modules migrate **incrementally** out of the current `lib/` + `app/api/` layout —
each module is extracted in the first phase that touches it, never as a big-bang
restructure (ADR-001). Target:

```
modules/
  tenancy/        Organization, ClientAccount, scope resolution      ← new (P2)
  rbac/           roles, permissions matrix, authorize()             ← grows from lib/authz.ts + lib/visibility.ts
  users/          accounts, invites, password policy                 ← lib/passwords.ts + team APIs
  teams/          departments→teams, memberships, skills             ← lib/departments.ts, lib/skills.ts
  leads/          pipeline, stages, deal values, routing             ← lib/stages.ts, lib/auto-assign.ts, lib/matching.ts
  fields/         dynamic field engine                               ← lib/fields.ts (KEEP as-is)
  clients/        client records + ClientAccount linkage             ← client APIs
  tasks/          tasks & follow-ups                                 ← lib/tasks.ts
  activity/       timeline                                           ← activities API
  analytics/      metric layer                                       ← lib/analytics.ts (KEEP)
  billing/        invoices, payments                                 ← new (P4)
  messaging/      threads client↔team                                ← new (P3/P4)
  notifications/  in-app + email                                     ← lib/notifications.ts, lib/email/
  reports/        generated deliverables                             ← reworked from parked reports
  integrations/   google/ meta/ behind one adapter interface         ← new (P5), mock-first
  ai/             complete/embed/runAgentTask, AI_AGENT actors       ← new (P5)
  audit/          audit log write + read                             ← lib/audit.ts
  files/          storage, signed URLs, visibility flags             ← replaces uploads/ (P3)
  jobs/           one abstraction over cron/queue                    ← wraps app/api/cron/* now, Inngest later (ADR-004)
```

Module layout per CLAUDE.md §5 (`domain/ data/ server/ ui/`). A module exposes a
small public API; cross-module imports go through it.

## 3. Multi-tenancy (ADR-005)

- Shared schema. `Organization` is the SaaS tenant; **Advertise X itself is
  organization #1**. `ClientAccount` is a restaurant client within an
  organization; CLIENT users belong to exactly one.
- Every tenant-owned table gains `organizationId` (additive, backfilled to org #1);
  client-scoped tables also gain `clientAccountId`. `Settings` stops being a
  singleton and becomes per-organization.
- **Repositories are the wall.** All reads/writes go through `modules/*/data/`
  repositories that take a `Scope` (org + optional clientAccount + role facts)
  and inject it into every query. Direct `prisma.*` calls outside `data/` become
  a lint error once a module is extracted. This generalizes today's
  `departmentScope(viewer)` — which stays, as the intra-org department dimension.
- Postgres RLS as the second wall once versioned migrations exist (P2), keyed on
  a per-request `SET LOCAL` org id.

## 4. Authorization

- Roles: `FOUNDER`, `MANAGER`, `EMPLOYEE`, `CLIENT`, `AI_AGENT`. Mapping from
  today: ADMIN→FOUNDER, SUPPORT_ADMIN→MANAGER (label "Support" preserved),
  MEMBER→EMPLOYEE. Mapping is a data migration, not a rename-in-place, so the
  audit log's history stays truthful.
- One matrix in `config/permissions.ts`: resource × action × role × scope
  (`own` / `assigned` / `department` / `client-own` / `org`).
- Every server action/route calls `authorize(user, action, resource, scope)`
  before data access. The current serializer layer (`lib/serializers/`) remains
  as the egress half: authorize decides *may you act*, serializers decide *what
  leaves*. Both are tested in both directions, harness-style.

## 5. Contracts, jobs, AI, integrations, audit, files

- **Contracts:** Zod at every boundary (today: partial — most routes yes, some
  bodies unvalidated); one error envelope `{ error, fields? }` (today's shape,
  formalized); pagination on all lists (today: none — added per-module as
  extracted); idempotency keys on money mutations (P4).
- **Jobs:** `jobs/` interface now (`schedule`, `enqueue`, `run`), implemented on
  Vercel cron; swap to Inngest when anything needs retries/fan-out (ADR-004).
  The Hobby daily-cron constraint is documented in the follow-ups cron and lifts
  with the plan.
- **AI:** provider-agnostic `modules/ai` (`complete`, `embed`, `runAgentTask`);
  agents are `User` rows with `role = AI_AGENT` and explicit permissions; every
  agent action audit-logged; consequential actions gated on human approval (P5).
- **Integrations:** `modules/integrations/<provider>` implementing `connect`,
  `sync`, `fetchMetrics`. Mock adapters first; nothing outside the module knows
  a provider API (P5).
- **Audit:** extend today's `AuditLog` with `actorType` (`human|ai`),
  `organizationId`, and a `diff` JSON column; keep the typed action union.
- **Files:** S3-compatible store, validated type/size, signed URLs, tenant +
  client scope, `internal|client` visibility flag. Replaces `uploads/` (P3).

## 6. What deliberately does NOT change (continuity, ADR-001)

Next.js 14 App Router + TS strict · Tailwind + hand-built primitives (retokened,
not replaced by shadcn) · Prisma · NextAuth credentials (hardened per ADR-002)
· npm · root-level `app/` (module extraction happens under `modules/`, `src/` move
is cosmetic risk with no payoff now) · the HTTP harness suite, which extends to
tenancy isolation (`scopetest` per entity).
