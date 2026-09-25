# Phase 0 Report — for founder review

*Commit `b50016c` · 2026-09-25 · everything below verified on this checkout, not assumed.*

## Executive summary

The Metroctopus codebase is a **strong foundation, not a liability**. It already
practices half of the new doctrine: server-enforced scoping tested in both
directions, config in the database, designed empty states, a six-harness quality
gate, and a data-driven field/pipeline engine that generalizes cleanly to
multi-tenant use. The full gate is green on this exact checkout — `tsc`, lint,
build, 479 unit tests, and all six HTTP harnesses.

What it is **not** yet: tenant-aware (nothing carries `organizationId`), safely
migratable (prod schema has no version history), branded (README is still
"Agency OS"; 11 files of "the agency" copy), or §7-styled (the entire visual
identity is BWM's warm-white/green, by prior design decree). There is no client
portal, no billing, no integrations, no AI layer — those are new builds on a solid
base, not rescues.

**Recommendation:** evolve in place per ADR-001—006. No rewrite. Phase 1 = identity
& shell; tenancy in Phase 2. Full plan in `ASSESSMENT.md` §11 — a *proposal*,
since `docs/PHASES.md` was never provided.

## What Phase 0 ran on

`docs/REQUIREMENTS.md` and `docs/PHASES.md` do not exist — searched repo, GitHub
and disk; you instructed Phase 0 to proceed without them. Targets were taken from
`CLAUDE.md` §§1–7 and your pasted Phase 0 brief. **Both files are still wanted;
the requirements doc remains authoritative over everything in these documents.**

## Housekeeping performed (allowed by the phase brief)

1. BWM doctrine preserved unmodified → `docs/legacy/BWM_CLAUDE.md` (`9df12d4`), as you instructed.
2. Advertise X `CLAUDE.md` placed verbatim at root (`b50016c`).
3. Repo fast-forwarded to GitHub `main` — absorbed 8 external commits (~3,600 lines: Metroctopus rename, skill routing, password tooling, mobile fixes) and the assessment re-verified everything against them.
4. **Fixed a broken build:** `tsc` failed on checkout because the generated Prisma client predated `Lead.createdById` / `Settings.autoAssignEnabled`; `prisma generate` + `db push` repaired it. (Root cause noted as risk R6: no CI.)
5. CLAUDE.md §11 filled with the repository's real npm commands.

## Deliverables

`docs/ASSESSMENT.md` · `docs/ARCHITECTURE.md` · `docs/DATA_MODEL.md` (ERD +
migration strategy) · `docs/DECISIONS.md` (ADR-001…005 + ADR-006 BWM
reconciliation) · `docs/METRICS.md` (initialized with inherited formulas) ·
`docs/PHASE_LOG.md` · this report.

## Top risks (full table in ASSESSMENT §9)

R1 no versioned migrations (**High** — blocks safe tenancy) · R2 branding debt
incl. dead credentials in README (**High**) · R3 production seed doesn't force a
password change (**High**) · R4 scope enforcement is per-callsite until
repositories land (**Med-High**) · R6 no CI (**Med** — it already let a red-`tsc`
state onto `main`).

---

## The 5 decisions I need from you

**D1 — What happens to BWM?** Metroctopus is live with 6 BWM users, and BWM's
business lines (pilot cars, insurance, affiliates) are not restaurant marketing.
Choose one: **(a)** BWM becomes Organization #1 and keeps using the product as-is
while Advertise X features grow around it *(recommended — nothing breaks, tenancy
gets a real first tenant)*; **(b)** Advertise X is org #1 and BWM's instance is
frozen/retired; **(c)** they diverge as separate deployments *(recommend against:
"two systems stapled together")*. Also gates deleting `ServiceCatalog`/
`ServiceLead`/`isBusinessDev` (agency leftovers nothing uses).

**D2 — What do Departments become?** Today they're BWM's business lines and every
record requires one. Proposal: keep the mechanism, rename the concept to
**Teams/Service Lines** within an organization; for restaurant tenants they model
service offerings (Ads, SEO, Socials…). Confirm, or give the vocabulary you want —
it names tables, routes and UI copy from Phase 1 onward.

**D3 — Design retheme scope.** The legacy doctrine froze BWM's warm-white/green
design; your §7 mandates Obsidian & Gold. Every screen changes appearance. Confirm:
full retheme in Phase 1 (tokens + shell + all existing screens), or shell-first
(new `(admin)/(team)/(client)` chrome in Phase 1, per-screen migration after)?
*Recommended: full token swap in P1 — the components are token-driven, and living
half-themed is the worst of both.*

**D4 — Fate of the four parked modules** (per ADR-006): unpark-and-adapt
**attendance** and **scoring** for the Team OS pillar? Treat **retainer cycles**
as superseded by the future projects module? Treat **client KPIs** as superseded
by real integrations (P5)? Any module you'll never want can be scheduled for
deletion instead — say which.

**D5 — Auth path.** Keep hardened NextAuth credentials + build invite-only and
email verification on top (ADR-002, recommended), or move to a hosted provider
(Clerk) now and take the migration + vendor coupling early? Affects Phase 2/3
scope directly.

---

**Gate:** Phase 0 is complete and I've stopped. Reply **"Phase 0 approved"** with
answers to D1–D5 (or corrections to any ADR) and Phase 1 begins with an agreed
scope. Anything you change here propagates into the docs before code is touched.
