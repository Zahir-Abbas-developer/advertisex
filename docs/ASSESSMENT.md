# Phase 0 Assessment — the Metroctopus codebase

*Assessed at commit `b50016c` (2026-09-25). Every claim below was verified against
this checkout, not remembered — 8 commits (~3,600 lines) landed between the last
audit and this assessment, and several earlier findings changed.*

**Inputs available:** `CLAUDE.md` (Advertise X doctrine), `docs/legacy/BWM_CLAUDE.md`
(the doctrine this codebase was built against), the codebase itself, and the founder's
pasted Phase 0 brief. **Inputs missing:** `docs/REQUIREMENTS.md` and `docs/PHASES.md`
were never provided; the founder instructed Phase 0 to proceed without them. Where
this assessment says "target", it means CLAUDE.md §§1–7 — the authoritative
requirements document may adjust any of it.

---

## 1. Current Architecture

| Concern | What exists | Where |
| --- | --- | --- |
| Framework | Next.js **14.2.33**, App Router, TypeScript strict | `next.config.mjs`, `tsconfig.json` |
| Routing | Root-level `app/` (no `src/`); route groups `(app)/` for the shell, bare routes for `/login`, `/change-password` | `app/` |
| Pages / APIs | 28 pages, 83 route handlers | `app/**/page.tsx`, `app/api/**/route.ts` |
| State | Server components + fetch-in-client components with `useState`; no global store, no React Query | throughout `components/` |
| Data layer | Prisma **5.22.0**; singleton client; queries written per-route (no repository layer) | `lib/prisma.ts`, `app/api/**` |
| Database | SQLite in dev, Postgres (Neon) in prod; provider flipped by script from `DATABASE_URL`; **`db push`, no migration history** — `prisma/migrations/` exists but is stale and unused | `scripts/sync-db-provider.mjs`, `prisma/` |
| Auth | NextAuth v4 credentials provider, JWT sessions (7d), bcrypt, per-IP + per-account login rate limiting, forced first-login password change enforced in the app shell | `lib/auth.ts`, `lib/rate-limit.ts`, `lib/passwords.ts`, `app/change-password/` |
| Authorization | Role check helpers + a central serializer layer that strips fields per viewer; department scope resolved per-request onto a `Viewer` and injected via `departmentScope()` | `lib/constants.ts` (`hasAdminPower`), `lib/authz.ts`, `lib/visibility.ts`, `lib/serializers/`, `lib/viewer.ts` |
| Styling | Tailwind with a bespoke token set (BWM palette), ~20 hand-built primitives — **no shadcn/ui** | `tailwind.config.ts`, `app/globals.css`, `components/ui/` |
| Jobs | 4 Vercel crons (evaluate, reports, digest, follow-ups), bearer-secret auth; no queue, no abstraction | `vercel.json`, `app/api/cron/`, `lib/cron-auth.ts` |
| Email | Hand-rolled HTML templates behind `lib/email/dispatch.ts`; transport is env-dependent | `lib/email/` |
| Files | Local `uploads/` + raw serving route; no validation pipeline, no signed URLs, unusable on Vercel's read-only FS | `app/api/attachments/`, `uploads/` |
| Tests | 24 unit test files, **479 passing**; plus 6 bespoke HTTP harnesses (smoke, smoke:empty, permtest, leaks, fieldtest, journeytest) and a real-browser hydration pass | `tests/`, `scripts/*.mjs` |
| CI | **None.** No GitHub Actions, no hooks; the gate is run by hand | — |
| Observability | Error boundaries report to `/api/system-errors`; admin reads them at `/admin/errors`. No structured logging, no Sentry | `lib/system-errors.ts` |
| Deployment | Vercel (Hobby — daily-cron limit already shaped one design), Neon Postgres; live at agency-os-three-alpha.vercel.app | `DEPLOY.md`, `vercel.json` |
| Config | `.env` + Vercel env vars; feature flags and all business config in the DB (`Settings` singleton, `Department`, `PipelineStage`, `FieldDefinition`) | `lib/settings.ts`, `lib/modules.ts` |

**Quality gate, verified on this checkout today:** `tsc` clean · `next lint` clean ·
`build` passes · unit tests 479/479 · HTTP harnesses — see §12 results table.
(One repair was needed first: the generated Prisma client was stale against the
schema's new `Lead.createdById` and `Settings.autoAssignEnabled`; `prisma generate`
+ `db push` fixed `tsc`. Listed as Phase 0 housekeeping.)

## 2. Existing Features

| Feature | State | Key files |
| --- | --- | --- |
| Departments (business lines): CRUD, reorder, deactivate-with-migration, per-dept team+skills | Working, admin-editable | `components/settings/DepartmentsManager.tsx`, `app/api/departments/` |
| Dynamic field engine: per-dept, per-entity (LEAD/CLIENT) field definitions, 10 types, conditional visibility, validation, admin UI | Working; **read by lead flow only — client wizard collects none** | `lib/fields.ts`, `components/fields/`, `app/api/departments/[id]/fields/` |
| Pipelines: per-dept stages with `kind` (OPEN/WON/LOST/ACTIVE_CLIENT), admin editor with move-records-on-retire, kanban board with dept switcher, deal values, commissions table | Working end-to-end (`journeytest`) | `lib/stages.ts`, `components/pipeline/`, `app/api/pipeline/`, `components/settings/DepartmentPipelineModal.tsx` |
| Leads: dept-first 3-step wizard, dynamic fields, skill-ranked assignee picker, auto-routing (`autoAssignEnabled`), edit form, stage moves with LOST-reason and win side-effects | Working | `components/pipeline/LeadFormModal.tsx`, `LeadEditForm.tsx`, `lib/auto-assign.ts`, `lib/matching.ts`, `lib/lead-access.ts` |
| Clients: onboarding wizard (dept-first as of `bd38ff5`), browser with dept chips, adaptive profile with dynamic-field panel + timeline | Working; wizard still skips dynamic fields | `components/clients/` |
| Tasks & follow-ups: Today/Upcoming/Overdue/Completed board, projected follow-ups (never copied), snooze/log-outcome that refuses to clear without a next date, 9am-window cron | Working | `lib/tasks.ts`, `components/tasks/`, `app/api/cron/follow-ups/` |
| Activity timeline: one endpoint for leads+clients, quick-log bar, type filter, system-vs-human entries, undeletable system rows | Working | `lib/…`, `components/activity/ActivityTimeline.tsx`, `app/api/activities/` |
| Analytics: scoped metric layer (12 totals, 3 chart series, per-dept/per-member tables), unit-tested | **Built but unwired — the dashboard doesn't use it** | `lib/analytics.ts`, `app/api/analytics/` |
| Search (⌘K): leads+clients+members, partial phone/email, dept-scoped | Working | `app/api/search/route.ts`, `components/layout/CommandPalette.tsx` |
| Team: roster, dept badges + skills inline-edit, role management, admin password reset (new), per-account passwords script | Working | `components/team/`, `app/api/team/`, `scripts/set-passwords.mjs` |
| Auth flows: login, forced first-change, self password change, admin reset | Working | `app/login/`, `app/change-password/`, `app/api/me/password/` |
| Audit log: typed action union, admin viewer | Working, but coverage is per-route discipline, not structural | `lib/audit.ts`, `app/(app)/admin/` |
| Notifications: in-app bell, dedupe keys, email digests | Working | `lib/notifications.ts`, `components/layout/NotificationBell.tsx` |
| Parked (flagged off, invisible): attendance/availability checks, scoring engine + disputes + incentives, retainer project cycles + milestone board, client KPI/ROAS + MRR | Dormant but complete; smoke asserts invisibility | `lib/modules.ts` and the modules it gates |

## 3. Reusable Components & Utilities — keep / improve / replace

**KEEP** (production-quality, carry into Advertise X):
`lib/fields.ts` · `lib/stages.ts` · `lib/tasks.ts` · `lib/analytics.ts` ·
`lib/visibility.ts` + `lib/serializers/` (the field-stripping pattern is exactly
CLAUDE.md §6's "server refuses it") · `lib/date.ts` (DST-correct, tested) ·
`lib/matching.ts` + `lib/auto-assign.ts` · `lib/passwords.ts` · `lib/notifications.ts` ·
the six HTTP harnesses in `scripts/` (they are the most valuable asset in the repo —
they test both directions: what a role gets *and* what it must not) ·
`Table`, `Modal`, `Drawer`, `Tabs`, `Toast`, `Skeleton`, `EmptyState`, `Select`,
`Input`, `Textarea`, `CommandPalette` (structure/behavior; tokens will change).

**IMPROVE:**
- `lib/authz.ts` — a real matrix exists but is consulted inconsistently; routes mostly call `hasAdminPower()` directly. Consolidate into the §5 `authorize(user, action, resource, scope)` shape. *(Reason: one enforcement point or the matrix is decorative.)*
- Data access — queries live inside 83 route handlers. Extract per-entity repositories that inject scope, per §5. *(Reason: `departmentScope()` exists but must be remembered at every call site; the dashboard leak happened exactly this way.)*
- `lib/email/` — keep templates, put transport behind an interface (Resend later).
- `StatCard`, chart components — keep shape, retheme; charts must move to `--data-*` tokens.
- `prisma/seed.ts` — good converge-don't-clobber behavior since `b15bbfa`; needs org/tenant awareness.

**REPLACE:**
- `uploads/` local file storage → S3-compatible + signed URLs (§5). *(Broken on Vercel today.)*
- `LOST_REASON`s, `LEAD_SOURCES`, `JOB_TITLES` hardcoded unions in `lib/pipeline-types.ts`/`constants.ts` → DB-backed config. *(Violates the config-in-DB rule both doctrines share.)*
- `ServiceCatalog` / `ServiceLead` / `isBusinessDev` / pod visibility — agency-era concepts nothing in BWM or Advertise X needs; superseded by department/team scope. *(Flagged in legacy doctrine as "needs a decision"; the decision belongs in D1/D4.)*
- The legacy global-pipeline metrics in `lib/pipeline.ts` (`OPEN_STAGES` constants) → already superseded by `lib/analytics.ts` + `lib/stages.ts`; delete after the dashboard is rewired.

## 4. Database Structure (current)

41 models. The live core: `User`, `Department`, `DepartmentMembership`,
`PipelineStage`, `FieldDefinition`/`FieldValue`, `Lead`, `Client`, `Task`,
`SalesActivity`, `Notification`, `AuditLog`, `Settings` (singleton), `SystemError`.
Parked-module models (Milestone/Project/ScoreEvent/Attendance*/Kpi/Mrr, ~20 more)
are populated only when their flags are on.

Strengths: every business record carries a required `departmentId`; stage meaning
lives in data (`kind`), not string comparisons; field values are typed-text with one
parsing owner; converge-style seed.

Gaps vs the target model (details in `docs/DATA_MODEL.md`):
- **No tenancy keys.** Nothing carries `organizationId`/`clientAccountId`; `Settings` is a global singleton.
- **No migration history.** `db push` only; the checked-in `prisma/migrations/` is stale (it broke a deploy once — see PROGRESS 9 Sep). Postgres prod has no versioned path.
- **Polymorphic without FK:** `FieldValue.recordId` (documented, cleanup owned by `deleteFieldValues`) — acceptable, but must not spread.
- **Missing indexes:** `Task.createdById`, `SalesActivity.type`, `Lead.createdById`, `AuditLog.entityId` composite.
- **No entities for:** invoices/billing, messaging, client-portal users, integrations, AI agents, invites, reports-as-artifacts.

## 5. UI/UX — honest assessment vs CLAUDE.md §7

The current system is **the BWM identity: warm-white editorial, Syne/DM Sans, green
accent** — deliberately, under the legacy doctrine's design freeze. Judged against
§7 "Obsidian & Gold" it is a wholesale mismatch: light theme, wrong families, wrong
tokens, green-not-gold, no KPI-tile sparkline language, no ⌘K-first density model.

What survives a retheme with credit: the discipline (1px borders not shadows,
generous space, designed empty states everywhere, no zebra tables, consistent pill
badges, tabular-nums already used on money) and the component *behavior* (tables,
modals, drawers, pickers, palette). What reads generic today even by BWM's own
standard: the dashboard (a grid of stat tiles + lists, no filter bar, mixed module
content), and forms density on `/settings`. Nothing violates §7's "Never" list in
kind (no emojis, no gradients, no chart junk) — the violation is the entire palette
and type system, which is a token swap plus per-screen re-balancing, not a rebuild
of component logic. **This is founder decision D3.**

## 6. What to Preserve

The invariants, more than the code: server-side scope enforcement with tests in both
directions; config-in-DB; "off is invisible, not empty"; empty states as features;
the stability-gate habit; the converge seed; forced password change; the harness
suite. Plus every KEEP item in §3.

## 7. What to Improve

Consolidated: one `authorize()` enforcement point; repository layer with injected
scope; versioned migrations; the dashboard rewired to `lib/analytics.ts`; client
wizard rendering dynamic fields; CI running the gate; structured logging; storage.

## 8. What is Missing (for the Advertise X product)

Tenancy (Organization/ClientAccount) · client portal experience + CLIENT role ·
AI_AGENT actor model · billing/invoices · messaging · integrations layer (even mock
adapters) · invite-only account issuance + email verification · reports-as-deliverables ·
`docs/REQUIREMENTS.md` and `docs/PHASES.md` themselves.

## 9. Technical Debt & Risks

| # | Item | Severity | Notes |
| --- | --- | --- | --- |
| R1 | **No versioned migrations**; prod schema evolved by `db push` from dev machines | **High** | One bad push is unrecoverable-by-replay; blocks safe tenancy retrofit |
| R2 | **README/branding debt**: root README still "Agency OS" with `admin@agency.local`; 11 files of "the agency" user-visible strings | High (trust/onboarding) | Audit point 1; unchanged by the Metroctopus rename commit |
| R3 | Production seed (`db:seed:admin`) never sets `mustChangePassword`; no `seed:prod` script | High (security) | Violates both doctrines' credential rule |
| R4 | Scope enforcement is per-callsite; the one aggregate that bypassed it (dashboard tile) already leaked once | Medium-High | Structural fix = repositories (§5); harness now renders pages, keep that |
| R5 | File uploads write to local disk | Medium | Broken on Vercel; replace before any client-facing files |
| R6 | No CI; gate is manual honor-system | Medium | 8 recent commits landed with a stale generated client → `tsc` was red on checkout |
| R7 | Hardcoded unions (lead sources, lost reasons, job titles) | Medium | Contradicts config-in-DB |
| R8 | `next lint` is default-config only; `strict` TS but no `no-any` rule enforced | Low-Medium | §8 requires more |
| R9 | Dead/duplicated layers: `lib/pipeline.ts` legacy metrics, `ServiceCatalog`/`ServiceLead`, `User.jobTitle` auto-assignment path superseded by `lib/auto-assign.ts` | Low | Delete after D1/D4 |
| R10 | Hobby-plan cron limit already forced a design compromise (follow-up window 8–10) | Low | Pro plan or external scheduler restores exactness |

## 10. Recommended Architecture

See `docs/ARCHITECTURE.md`. Summary: keep the stack (ADR-001), evolve structure
in place — introduce `modules/` boundaries and repositories incrementally starting
with the entities Phase 1 touches, rather than a big-bang `src/` move; tenancy as
additive columns + repository-injected scope (ADR-005); the existing serializer
layer becomes each module's egress guard.

## 11. Recommended Phases

`docs/PHASES.md` was never provided, so this is a **proposal**, not a review:

- **P1 — Identity & shell:** Advertise X rebrand (kills R2), Obsidian & Gold token
  system + `DESIGN_SYSTEM.md`, the three route groups `(admin)/(team)/(client)`
  as shells, dashboard rewired to `lib/analytics.ts` (closes audit 8), client
  wizard dynamic fields (closes audit 5), versioned-migrations baseline (kills R1),
  CI running the gate (kills R6), `seed:prod` with forced change (kills R3).
- **P2 — Tenancy & authz:** Organization/ClientAccount additive migration, backfill
  org #1, repository layer + `authorize()`, isolation tests per entity.
- **P3 — Client portal:** CLIENT role, invites, portal views (projects, reports,
  messages, invoices-read), zero internal jargon.
- **P4 — Billing & finance:** invoices, payments state machine, founder finance view.
- **P5 — Integrations & AI:** mock Google/Meta adapters, `modules/ai` interfaces,
  AI_AGENT actor + audit, first agent task with human approval.
- **P6 — Team OS depth:** attendance/performance decisions (D4) executed.

Each phase ends at the CLAUDE.md §9 Definition of Done and a founder gate.
