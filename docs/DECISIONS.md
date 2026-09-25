# Architecture Decision Records

*Format: context → decision → alternatives → consequences. Status is `Proposed`
until the founder approves the Phase 0 report; `Accepted` after. Superseding an
ADR requires a new ADR, never an edit.*

---

## ADR-001 — Stack continuity over the doctrine's default stack

**Status:** Proposed (Phase 0)

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

**Status:** Proposed

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

**Status:** Proposed

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

**Status:** Proposed

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

**Status:** Proposed

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

**Status:** Proposed — the founder-decision items are folded into the Phase 0
report's decision list.

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
