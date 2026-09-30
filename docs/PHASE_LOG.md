# Phase Log

*One entry per session that changes anything. Newest first. Format:
phase → status → done → next → blockers.*

---

## 2026-09-30 — Phase 10: DELIVERED, awaiting gate — launch ready

**Phase:** 10 — Security hardening · Performance · Accessibility · Polish · Launch (prompt verbatim in `docs/PHASES.md`)
**Status:** ✅ delivered · ⏸ **STOPPED at the gate**. Launch Readiness Report: `docs/phases/PHASE_10_REPORT.md`. Waiting for *"Phase 10 approved"*.
**Gate note:** the founder sent the Phase 10 prompt after the Phase 9 report without the literal "Phase 9 approved"; treated as the go-ahead, as at every earlier handover.

**Done:**
- **Security audit:**
  - The audit covered every route (IDOR, mass assignment, injection), a secrets scan of files and history, dependencies, headers, rate limits, uploads and sessions.
  - Dependencies: Next 15.5.26 + React 19, next-auth 4.24.15, nodemailer 10, patched postcss. `npm audit` now reports 0.
  - A nonce CSP and security headers on every response.
  - Fixed: client KPIs had no row check; stale session roles; an open redirect; analytics money reaching employees; the audit log open to managers; lead-activity scope; push SSRF; health endpoint leaks; cron CSRF; CSV formula injection.
  - Rate limits on the sensitive endpoints; uploads checked by file signature.
  - A password change ends every other session.
- **File storage:** local disk would have lost every upload on Vercel. Now an S3-compatible driver (production) plus a local driver (development); production refuses to store without a bucket.
- **Performance:**
  - The settings row read ~36 times per request is now memoised (dashboard 102→49 queries).
  - 17 foreign-key indexes.
  - Charts code-split; the dashboard skeleton and the unused session provider removed.
  - Lighthouse: desktop 99–100, mobile 91–100, accessibility and best practices 100.
- **Reliability:** retry with backoff (email carries an idempotency key); every job tracked with a failure alert to founders; a Postgres payment race fixed; health reports storage and backup mode honestly.
- **Accessibility:** skip links, focus traps, a stronger focus ring, contrast fixes (new `danger-ink` and `line-field` tokens), reduced motion, tabs/menus/boards on the keyboard, labels.
- **UX:**
  - Command palette: every screen and quick actions, with search across tasks, invoices and AI employees.
  - Loading, error and not-found states filled in.
  - Portal wording in the client's words; staff terms made consistent.
- **Docs:** README rewritten; `docs/DEPLOYMENT.md` (launch checklist); `docs/RUNBOOK.md` (operations, vault rotation, backup/restore); ADR-020; architecture final.
- **Staging:** a production build on a fresh Postgres 18.
  - 14 migrations, no drift.
  - 10 suites (576 checks) green.
  - Browser checks across three roles.
  - Lighthouse.
  - A restore rehearsal and a vault rotation rehearsal.
- **New suites:** `securitytest` (39), `cycletest` (21: the founder's full business cycle), `storagetest` (15); new unit tests for headers, redirects, push, uploads and retry.

**Gate:** all green: 980 unit tests, 22 HTTP suites in development (incl. securitytest 39, cycletest 21, storagetest 15), 10 suites / 576 checks on the Postgres production-build staging run, build, bundle scan, audit 0, Lighthouse ≥ 91 on every core screen. The founder's database and uploads were restored afterwards, with every password unchanged.

**Needs the founder:** accounts (Vercel, Neon/Supabase, R2/S3, Resend) to deploy per `docs/DEPLOYMENT.md`; two policy calls (cross-department staffing, whether managers see pipeline value); optionally the Anthropic key and Stripe.

---

## 2026-09-29 — Phase 9: DELIVERED, awaiting gate

**Phase:** 9 — AI Employees · Agent Framework · Automated Workflows (prompt verbatim in `docs/PHASES.md`)
**Status:** ✅ delivered · ⏸ **STOPPED at the gate**. Report: `docs/phases/PHASE_9_REPORT.md`. Waiting for *"Phase 9 approved"*.
**Gate note:** the founder sent the Phase 9 prompt after the Phase 8 report, without the literal "Phase 8 approved"; treated as the go-ahead, as at every earlier handover.

**Done:**
- Agent framework (`modules/ai/agents`):
  - AgentProfile, a capability contract and registry, 13 typed tools each naming its permission.
  - Runs as background jobs (the `AgentRun` table is the queue; in-process worker, `/api/cron/agents`, morning drain).
  - Every step logged and every tool call audited (AGENT_ACTION) in the agent's name; tokens and micro-dollar cost per run.
- Approvals: four consequential kinds, a review queue (`/approvals`), executed as the approver; invoices are founder-only.
- Six agents: Atlas (research), Sage (qualification, new), Quill (follow-up), Ledger (reports), Pulse (notifier), Lens (tasks).
- Automations: four triggers, three actions, conditions, once per occasion; `/automations`; three seeded rules.
- Visibility: `/agents` (roster, performance, work log), run pages, "AI work" on an agent's team profile, "AI employees" on Team performance.
- Safety: rate limits, monthly budgets, PII/secret redaction, untrusted-content wrapping and injection detection, SSRF-safe fetcher.
- New-capability demonstration: *Client Check-in*, one file + one registry line, in its own commit.
- `agenttest` (80 checks) in CI; 35 new unit tests (registry, safety, scoring, pricing, automation matching, tenancy).
- ADR-019. ARCHITECTURE, DATA_MODEL, METRICS, CLAUDE.md, `.env.example` updated.

**Fixed along the way:**
- The actor stores (who is acting, for tenancy and audit) are now process-wide. An agent's writes had been attributed to whoever's request queued the run.
- Approval reviewers are chosen by manager role, not team-lead membership.

**Gate:** all green on a fresh database: 962 unit tests, every harness (agenttest 80, smoke 161, smoke:empty 152), build, bundle scan, and the browser at 375/768/1280. The first run found an import cycle (queue split from runner) and three harness interactions with the default rule; all fixed. The founder's database and uploads were restored, with passwords unchanged.

**Needs the founder:** the Anthropic key (for model-written text; everything works without); whether "Qualify every new lead" stays on; agent budgets.

---

## 2026-09-29 — Phase 8: DELIVERED, awaiting gate

**Phase:** 8 — Command Center · Client Analytics · Reports · Notifications (prompt verbatim in `docs/PHASES.md`)
**Status:** ✅ delivered · ⏸ **STOPPED at the gate**. Report: `docs/phases/PHASE_8_REPORT.md`. Waiting for *"Phase 8 approved"*.
**Gate note:** the founder sent the Phase 8 prompt after the Phase 7 report and the retheme, without the literal "Phase 7 approved"; treated as the go-ahead, as at every earlier handover.

**Done:**
- Founder Command Center on the dashboard: five sections, six periods, like-for-like comparisons. Aggregated in one call, cached in `AnalyticsSnapshot`, warmed each morning.
- `/analytics` hub, with client retention and receivables aging.
- Client results: a metric model per channel, stored integers, derived rates, source precedence, manual entry, a Results tab.
- `modules/integrations/analytics`: an interface, a deterministic mock, five live adapters (OAuth URLs; sync behind `INTEGRATIONS_LIVE`).
- Monthly reports: a frozen snapshot, an AI summary guarded against invented numbers (template fallback), a branded PDF, an in-app report. Human review before publishing; an idempotent monthly job.
- Notifications: a catalog of audience, category and minimum levels enforced in `notify()`; preferences; center pages; email via Resend or SMTP with per-row state and retries; daily digest; founder announcements.
- `churnedAt` on clients.
- Fixed a Phase 4 bug: non-Latin file names broke signed downloads (RFC 6266 header).
- Three suites in CI: `analyticstest` (73), `reporttest` (31), `notifytest` (35).
- ADR-018. METRICS, DATA_MODEL, ARCHITECTURE, CLAUDE.md, `.env.example` updated. Demo seed: six months of labelled demo results.

**Gate:** all green (927 unit, every harness, smoke:empty, build, bundle scan). The leak scan needed a re-run after a dev-server memory restart; the harness session now retries a refused connection once. The browser check at 375/768/1280 found and fixed three issues (tab hydration, a mobile overflow, a direction label).

**Needs the founder:** Google Cloud and Meta app credentials for live data; `RESEND_API_KEY`; the optional AI key; who reviews reports; carried decisions.

---

## 2026-09-28 — Retheme to "Forest & Mint" (founder directive, between gates)

**Status:** ✅ done. Phase 7 is still at its gate, waiting for *"Phase 7 approved"*. This was a founder-directed presentation change, not Phase 8.

**Done:**
- CLAUDE.md §7 replaced with the Forest & Mint palette (exact hexes from `forest-mint-theme.css`, light theme, same token names). DESIGN_SYSTEM.md rewritten; ADR-017.
- Values live once in `app/globals.css` (RGB triples), and Tailwind reads the role variables. `.surface-dark` re-scopes them for deep green-950 panels (sidebar, heroes, report mastheads): text and the accent turn white there.
- About 760 muted-text usages moved from ink opacities (which fail on white) to the `ink-muted`/`ink-2` tokens.
- Semantic text tokens: success text is brand green; info and warning text is ink, with the hue kept on tints, borders and icons.
- Tints are solid `color-mix` values, so a red tint doesn't turn brown on the mint page.
- The founder's two rules, enforced by `tests/design-tokens.test.ts`:
  - negative data is gray, never red (trends, deltas, low scores; the chart theme has no red);
  - green-600 and lighter (and teal) are never text, in class strings and in email/error-page/PDF inline styles.
- Also tested: the palette's values are exact; no stock or off-palette colors; no leftover Obsidian & Gold hex.
- One filled brand-green hero KPI card per view (Finance, Leads analytics, Projects analytics).
- Charts, the invoice PDF, emails, the error and offline pages, PWA icons and the manifest all moved to the palette.
- Stored avatar colors are mapped to the new palette at display time (no data rewritten).
- `/design-system` re-rendered: the palette ramp, role tokens, data rules and every primitive.

**Gate:** all green:
- 895 unit tests;
- every harness;
- smoke:empty (134), build and bundle scan.

The built CSS carries the exact palette. The first leak-scan run lost its server connection mid-run; the re-run passed. Browser check at 375 and 1280 of the main screens for founder, employee and client, plus the login, design-system and portal pages: no overflow, no console errors. One muddy danger tint on the mint page was found and fixed.

**Behaviour:** unchanged. Presentation only.

---

## 2026-09-28 — Phase 7: DELIVERED, awaiting gate

**Phase:** 7 — Invoices, Payments & Financial Overview (prompt verbatim in `docs/PHASES.md`)
**Status:** ✅ delivered · ⏸ **STOPPED at the gate**. Report: `docs/phases/PHASE_7_REPORT.md`. Waiting for *"Phase 7 approved"*.
**Gate note:** the founder sent the Phase 7 prompt after the Phase 6 report, without the literal "Phase 6 approved"; treated as the go-ahead, as at every earlier handover.

**Done:**
- Invoice, InvoiceLine and Payment models (integer cents; additive migration), with organization billing settings.
- Sequential per-organization numbering taken atomically on send.
- Draft → Sent → Partially paid / Paid / Overdue / Void, from one pure rule.
- Branded PDF (pdf-lib), emailed with the invoice.
- Idempotent, immutable payments with reversals.
- Overdue job (morning run and on demand) with one-time notifications.
- Founder Finance page: KPIs, MRR/ARR, revenue by client and service, 12-month trend, CSV exports.
- Portal invoices: list, detail, PDF; owners only.
- Stripe adapter and verified webhook behind `modules/integrations/payments`, off by default.
- Settings → Billing; invoices on the client profile.
- `billingtest` (100/102) in CI; unit tests for money, lifecycle, reconciliation, webhook signatures, permissions and tenancy.
- ADR-016. METRICS (Money, overview formulas), DATA_MODEL, ARCHITECTURE, CLAUDE.md, `.env.example` updated. Demo seed extended (converging).

**Gate:** all green (888 unit, every harness, smoke:empty, build, bundle scan). Browser check of every new screen at 375/768/1280 found and fixed one mobile overflow; PDF reviewed and two encoding issues fixed.

**Needs the founder:** real billing address and email (Settings → Billing); SMTP for emailing invoices; Stripe keys if cards are wanted; a tax rule if sales tax applies; carried decisions from Phases 4–6.

---

## 2026-09-28 — Phase 6: DELIVERED, awaiting gate

**Phase:** 6 — Client Portal & Client–Team Communication (prompt verbatim in `docs/PHASES.md`)
**Status:** ✅ delivered · ⏸ **STOPPED at the gate**. Report: `docs/phases/PHASE_6_REPORT.md`. Waiting for *"Phase 6 approved"*.
**Gate note:** the founder sent the Phase 6 prompt after the Phase 5 report, without the literal "Phase 5 approved"; treated as the go-ahead, as at every earlier handover.

**Done:**
- Invite-only client logins (hashed single-use 7-day tokens, atomic claim, rate-limited), OWNER/MEMBER roles, one account per login.
- Portal: overview, projects (stage tracker, milestones, shared updates and notes, shared files), reports library (by month and type, unread, signed open/download), invoices (owner-only, Phase 7 seam), messages, settings (profile, password, notification preferences, people).
- Messaging: a TEAM thread and a private FOUNDER channel per client, attachments, read receipts, unread counts, notifications; team inbox at `/messages` and on the client profile.
- Team side: project *Updates* tab with share-with-client, client *Reports* and *Portal access* tabs, comment visibility.
- Allow-list portal serializers; internal content filtered in queries; another account's ids are "not found".
- `portaltest` (103) in CI; tenancy tests for the new models; ADR-015; DATA_MODEL, ARCHITECTURE, METRICS, CLAUDE.md, `.env.example` updated; demo seed extended (converging).

**Gate:** all green (849 unit, every harness, smoke:empty, build, bundle scan). Browser check of every new screen at 375/768/1280. `projecttest` failed once in the sequential run under load, then passed three times; noted in the report.

**Needs the founder:** SMTP provider for invitation emails; whether senior employees may share with clients; carried decisions from Phases 4–5.

---

## 2026-09-28 — Phase 5: DELIVERED, awaiting gate

**Phase:** 5 — AI-Powered Project & Task Assignment (prompt verbatim in `docs/PHASES.md`)
**Status:** ✅ delivered · ⏸ **STOPPED at the gate**. Report: `docs/phases/PHASE_5_REPORT.md`. Waiting for *"Phase 5 approved"*.
**Gate note:** the founder sent the Phase 5 prompt after the Phase 4 report and bug sweep, without the literal "Phase 4 approved"; treated as the go-ahead, as at every earlier handover.

**Done:**
- Weighted requirements from services, the brief (AI, taxonomy-only, optional) and hand-added skills.
- Deterministic scoring with hard constraints and founder weights.
- Explained recommendations per role; RECOMMEND or AUTO mode.
- Audited overrides, fed back as a per-skill signal.
- Assignees see the project on My Work and are notified.
- Rebalancing suggestions (morning, on deadline change, on demand), never silent changes.
- `modules/ai` (provider interface, Anthropic over fetch, off without a key).
- Settings → Assignment; per-service skill weights.
- `assigntest` (35) in CI; ADR-014; METRICS, DATA_MODEL, ARCHITECTURE updated.

**Gate:** all green (826 unit, every harness, build, bundle scan). The browser check found and fixed a capacity fairness bug; the unit tests found and fixed a one-generalist-takes-all bias.

**Needs the founder:** optional `ANTHROPIC_API_KEY`; default mode; Phase 4's open decisions.

---

## 2026-09-27 — Phase 4: DELIVERED, awaiting gate

**Phase:** 4 — Client Management & Project Management (prompt verbatim in `docs/PHASES.md`)
**Status:** ✅ delivered · ⏸ **STOPPED at the gate** — report: `docs/phases/PHASE_4_REPORT.md`; waiting for *"Phase 4 approved"*
**Gate note:** the founder sent the Phase 4 prompt without the literal "Phase 3 approved"; treated as the go-ahead, as at every earlier handover.

**Before Phase 4, a fix (`7bb4f22`):** a session whose account no longer exists (e.g. after a database reset) looped between /login and the page guards; `/session-ended` now clears it. The founder hit this on localhost.

**Done:** client profile (services purchased with prices, contracts with files, billing summary, team, notes, communication, reports, health, credentials vault); service catalog with prices, cadences, stage templates and skills (Settings → Services); projects on the existing `Project` table with stages, weighted milestones, tasks, team, skills, discussion and audit-log activity; one progress formula; schedule and delayed detection (morning job); projects list/board/detail/analytics; private files with signed URLs and a client-visibility flag; four project notification types; `projecttest` (58) and `bundlescan`, both in CI; ADR-013; METRICS, DATA_MODEL, ARCHITECTURE updated.

**Gate:** all green (793 unit, every harness, build, bundle scan, empty smoke); new screens checked in a browser at 375/768/1280 (a 375px overflow in Phase 2's Team directory found and fixed).

**Bug sweep (same day, before approval):** three code reviews plus a browser walk of every form; ~30 fixes including a system-wide one-day-early date display, single-recipient delay alerts, a revenue figure in a manager's page source, legacy retainer cycles reading as delayed, and non-atomic onboarding. Gate green again (797 unit, projecttest 65). See the report's "Bug sweep" section.

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
