# Phase Log

*One entry per session that changes anything. Newest first. Format:
phase → status → done → next → blockers.*

---

## 2026-09-27 — Phase 4: DELIVERED, awaiting gate

**Phase:** 4 — Client Management & Project Management (prompt verbatim in `docs/PHASES.md`)
**Status:** ✅ delivered · ⏸ **STOPPED at the gate** — report: `docs/phases/PHASE_4_REPORT.md`; waiting for *"Phase 4 approved"*
**Gate note:** the founder sent the Phase 4 prompt without the literal "Phase 3 approved"; treated as the go-ahead, as at every earlier handover.

**Before Phase 4, a fix (`7bb4f22`):** a session whose account no longer exists (e.g. after a database reset) looped between /login and the page guards; `/session-ended` now clears it. The founder hit this on localhost.

**Done:** client profile (services purchased with prices, contracts with files, billing summary, team, notes, communication, reports, health, credentials vault); service catalog with prices, cadences, stage templates and skills (Settings → Services); projects on the existing `Project` table with stages, weighted milestones, tasks, team, skills, discussion and audit-log activity; one progress formula; schedule and delayed detection (morning job); projects list/board/detail/analytics; private files with signed URLs and a client-visibility flag; four project notification types; `projecttest` (58) and `bundlescan`, both in CI; ADR-013; METRICS, DATA_MODEL, ARCHITECTURE updated.

**Gate:** all green (793 unit, every harness, build, bundle scan, empty smoke); new screens checked in a browser at 375/768/1280 (a 375px overflow in Phase 2's Team directory found and fixed).

**Needs the founder:** production `VAULT_KEY`; a file storage bucket; what to do with any legacy retainer projects (and whether the retainer code can now be deleted); the Phase 3 stage-mapping decision.

**Carried:** `smoke:browser`; the Neon backup before the first deploy.

---

## 2026-09-26 — Phase 3: DELIVERED, awaiting gate

**Phase:** 3 — Lead Pipeline & Outreach Tracking (prompt verbatim in `docs/PHASES.md`)
**Status:** ✅ delivered · ⏸ **STOPPED at the gate**. Report: `docs/phases/PHASE_3_REPORT.md`. Waiting for *"Phase 3 approved"*.
**Gate note:** the founder issued the Phase 3 prompt after the Phase 2 report, without the literal "Phase 2 approved"; treated as the go-ahead, as at the Phase 1→2 handover.

**Done:**
- Lead fields and the standard stage template.
- `LeadStageEvent` stage history and `SavedView`.
- Keyboard drag-and-drop, the table view, filters and saved views.
- Outreach kinds with company-calendar rollups (`/outreach`).
- Leads analytics (`/pipeline/analytics`).
- One-transaction conversion.
- CSV import/export with duplicate detection.
- A board paged per column.
- Transaction-aware audit (`transaction()`).
- `leadtest` and `outreachtest`, added to CI.
- ADR-012; METRICS, DATA_MODEL and ARCHITECTURE updated.

**Gate:** everything green except `smoke:browser` (carried). The new screens were checked directly at 375, 768, 1280 and 1536.

**Harness fixes this session:**
- permtest and journeytest use the new activity types.
- fieldtest and journeytest pass `allowDuplicate`.
- journeytest assigns its task explicitly: auto-routing by workload moved with the new seed.
- The seed's lead values are distinct, so the leak scan can't match ordinary page text.
- `/pipeline/analytics` is registered in the route map as founder/manager.

**Needs the founder:**
- Whether to move existing departments onto the standard stages. That is a mapping script on live data; see the report.

**Carried:**
- `smoke:browser`.
- The Neon backup before the first deploy.
- The S3 file store.

---

## 2026-09-26 — Phase 2: DELIVERED, awaiting gate

**Phase:** 2 — Team Operating System (prompt verbatim in `docs/PHASES.md`)
**Status:** ✅ delivered · ⏸ **STOPPED at the gate** — report: `docs/phases/PHASE_2_REPORT.md`; waiting for *"Phase 2 approved"*
**Gate note:** the founder instructed "complete phase2 task" after Phase 1 was
delivered, without the literal "Phase 1 approved". Treated as the founder's
go-ahead (CLAUDE.md §12: follow the founder's call); Phase 1's report stands
for review and anything it surfaces is fixed first.

**Plan (increments):**
1. Domain engines, pure + tested: attendance (hours, breaks, late, early, absence, month) and tasks (4-status flow, deadlines, on-time rate, workload). Formulas in METRICS.
2. Schema: Skill + UserSkill (proficiency 1–5), WorkSchedule, User responsibilities/status, Task project link + checklist + comments, File.
3. APIs + permissions: employees, skills, time clock, team attendance (+CSV), tasks (transitions, checklist, comments, files, activity).
4. UI: employee directory with AI-agent treatment, profile page, My Work / My Performance dashboard, attendance (employee + founder), task detail, Team Performance analytics.
5. Deadline job + notifications (assigned, approaching, overdue).
6. Seed: skills catalog, schedules, demo tasks and attendance.
7. `daytest` harness (the day-in-the-life acceptance), gate, docs, `PHASE_2_REPORT.md`, STOP.

**Carried from Phase 1:** restore `smoke:browser` to green (stalls on the second role).

---

## 2026-09-25 — Phase 1: DELIVERED (`fd96776`)

**Report:** `docs/phases/PHASE_1_REPORT.md`. Gate green except `smoke:browser` (open item above).

### Phase 1 working log (historical)

**Phase:** 1 — Foundation (scope: the founder's Phase 1 prompt, issued 2026-09-25 — now verbatim in `docs/PHASES.md`; it supersedes the ASSESSMENT §11 proposal, see ADR-007)
**Status:** ▶ in progress — re-baselined mid-phase when the prompt arrived; increments 1–3 below sit inside its scope items 1, 7 and 11 and carry forward

**Approved decisions:** D1 brand→Advertise X (users/data untouched) · D2 departments→service lines for food brands (playbook-derived seed) · D3 full Obsidian & Gold retheme · D4 all modules stay parked (feasibility) · D5 NextAuth stays.

**Task list (increments, each committed green):**
1. ✅ Rebrand sweep (`7668b4d`) — name, README, manifest, wordmarks, "the agency" strings, package name. Kills R2.
2. ✅ Obsidian & Gold retheme (`fd0ed54`) — §7 tokens in `tailwind.config.ts` (values swapped under the existing class names; 97 files swept), Inter Tight/Inter fonts, dark-theme recharts + email + error-page palettes, gold-A icons, `DESIGN_SYSTEM.md`. Verified: tsc · lint · build · 479/479 · smoke:browser 69 pages × 3 roles · login screenshot. Executes D3.
3. ✅ Service-line seed per D2 (`339df3e`) — Appetite Audit · Growth Sprint · Creative Studio · Web & Retention, each with its own pipeline and field set (incl. a MULTISELECT-conditional field); membership matrix with deliberate gaps (scoping tests rely on them); placeholder password `advertisex-change-me`; login-rail copy. Harnesses generalised off BWM slugs: permtest derives a department the probe user is not in, journeytest/fieldtest answer required fields by type, commission check runs wherever a `commission_rate` field exists (skips loudly otherwise). Existing databases keep their BWM departments — the seed creates, never destroys; founder retires them in Settings (per D2 record). Verified: smoke ×2 · permtest · leaks · fieldtest · journeytest 73 · tsc · lint · 479/479.
4. Schema foundation (scope 3): Organization · ClientAccount (skeleton) · AuditLog · Notification (skeleton) · File (skeleton) · role enum FOUNDER/MANAGER/EMPLOYEE/CLIENT/AI_AGENT (additive mapping per ADR-007) · tenancy keys + FK indexes · **migrations baseline** (kills R1).
5. RBAC (scope 6): `config/permissions.ts` matrix · `authorize(user, action, resource, scope)` in every handler · roles in session (scope 5) · isolation tests for CLIENT, EMPLOYEE, MANAGER, FOUNDER, AI_AGENT.
6. Repositories (scope 4): tenant-scoped data access, no raw unscoped queries; audit utility wired into mutations (scope 9).
7. Module structure (scope 2): incremental behavior-preserving moves into §5 layout, every move recorded, gate green per move.
8. Design system completion (scope 7): missing primitives (Checkbox, Dropdown, Tooltip, Pagination, KPI tile as component) + dev-only `/design-system` showcase route.
9. Shells (scope 8): route groups (auth)/(admin)/(team)/(client), client shell with placeholder dashboard, notifications bell skeleton, responsive.
10. Observability (scope 10): structured logger; existing SystemError log + admin/errors extended as the Sentry-equivalent; error/not-found pages already rethemed.
11. Seed (scope 11): 1 org · founder · manager · 5 employees · 5 AI-agent users · 3 restaurant client accounts with 1 client user each — layered on the D2 service lines.
12. Full gate · PRESERVE-list verification · docs updates · `PHASE_1_REPORT.md` · **STOP** for "Phase 1 approved".

**Deploy preconditions (ADR-008):** before the first Phase 1 production deploy, (1) a Neon branch of production is taken, which serves as backup and clone, (2) the migration rehearsal is repeated against it, (3) `BASELINE_BACKUP_CONFIRMED=1` is set for that one deploy. Role backfill (`npm run roles:backfill`) runs only *after* the new deployment is live.

**Blockers:** none for building. Production backup/clone needs Neon access (the URL is a sensitive Vercel variable, so it can't be pulled locally). `REQUIREMENTS.md` still wanted.

---

## 2026-09-25 — Phase 0: DELIVERED, awaiting gate

**Phase:** 0 — Deep Analysis & Blueprint
**Status:** ✅ delivered · ⏸ **STOPPED at the gate** — waiting for *"Phase 0 approved"* + the 5 decisions

**Done**
- Housekeeping: BWM doctrine preserved (`docs/legacy/BWM_CLAUDE.md`, `9df12d4`); Advertise X `CLAUDE.md` adopted verbatim (`b50016c`); repo fast-forwarded to GitHub `main` (`a1782f0`, 8 external commits absorbed); **broken build repaired** — stale generated Prisma client made `tsc` fail on checkout → `prisma generate` + `db push`; CLAUDE.md §11 filled with the repo's real commands.
- Full quality gate run on this exact checkout — all green: `tsc` · `next lint` · `build` · unit 479/479 · smoke ×2 · permtest · leaks · fieldtest · journeytest.
- Delivered: `ASSESSMENT.md`, `ARCHITECTURE.md`, `DATA_MODEL.md`, `DECISIONS.md` (ADR-001…006 incl. BWM reconciliation), `METRICS.md`, this log, `phases/PHASE_0_REPORT.md`.

**Next (after approval):** Phase 1 as proposed in ASSESSMENT §11 — identity & shell (rebrand, design tokens, dashboard rewire, client-wizard fields, migrations baseline, CI, seed:prod).

**Blockers**
- `docs/REQUIREMENTS.md` and `docs/PHASES.md` were never provided; Phase 0 ran on founder instruction without them. **The phase plan in ASSESSMENT §11 is a proposal, not a confirmed plan.** Both files remain wanted.
- The 5 founder decisions in `phases/PHASE_0_REPORT.md` (D1–D5) gate Phase 1's scope.
