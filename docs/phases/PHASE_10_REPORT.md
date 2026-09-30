# Phase 10 — Launch Readiness Report

*Date: 2026-09-30 · Scope: the founder's Phase 10 prompt (`docs/PHASES.md`) ·
Status: **ready to launch, pending the founder's accounts** (hosting,
database, bucket, email). Local only — nothing pushed, nothing deployed.*

## Verdict

**Advertise X is production-ready.**
- **Security:** no known critical or high issues remain. `npm audit` reports
  0 vulnerabilities. Every audit finding is fixed and pinned by a test.
- **Quality checks:** every check is green, on SQLite in development and on
  **Postgres in a production-mode staging run**.
- **Lighthouse:** 99–100 on desktop and 91–100 on mobile for performance,
  accessibility and best practices on every core screen of all three
  experiences.
- **Business cycle:** the founder can run lead → client → project → delivery
  → report → invoice → payment from the app alone, and the restaurant sees
  every step. `cycletest` does exactly this over HTTP: 21 of 21 checks, on
  both databases.

**What launch still needs from you** is accounts, not code: a Vercel
project, a Postgres database (Neon or Supabase), a private storage bucket
(Cloudflare R2 or AWS S3) and an email sender (Resend).
`docs/DEPLOYMENT.md` is the checklist, step by step.

**Gate note.** The Phase 10 prompt arrived after the Phase 9 report without
the literal "Phase 9 approved". As at every earlier handover, I treated it as
the go-ahead and recorded that in PHASE_LOG.

## 1. Security audit

**How the audit was done:**
- A route-by-route review of every API handler for IDOR, mass assignment and
  injection, run as three parallel reviews by area.
- A secrets scan of the tracked files and the full git history.
- A dependency audit.
- A review of headers, rate limits, uploads and sessions.

**What it found and what was done:**

| # | Severity | Finding | Fix | Proof |
| --- | --- | --- | --- | --- |
| 1 | **Critical** | Dependencies: Next 14.2.33 (~30 advisories: RSC denial of service, cache poisoning, middleware bypass, SSRF), next-auth < 4.24.15, nodemailer < 10, Next's own postcss | Next **15.5.26** + React 19, next-auth 4.24.15, nodemailer 10, patched postcss. The official codemod migrated 109 files to the async APIs. | `npm audit`: **0** |
| 2 | **High** | No security headers: no CSP, no HSTS, framing allowed | A nonce-based CSP on every page (no inline scripts, no eval in production), frame denial, nosniff, referrer and permissions policies, COOP, and HSTS over HTTPS | `securitytest` (6 checks), unit tests |
| 3 | **High** | Client KPI numbers had no row check: any login, portal clients included, could read any restaurant's weekly figures, and staff could overwrite them | Scoped to the client and the caller's reach | `securitytest` |
| 4 | **Critical for launch** | Files were written to the server's local disk, which is read-only and temporary on Vercel, so uploads would be lost | Storage interface: an S3-compatible driver (production) and a local driver (development). Production refuses to store without a bucket. | `storagetest` (15), staging |
| 5 | Medium | A demoted or deactivated person kept their powers until their 7-day token expired | The account is re-read on every request; a password change or reset now ends every other session | `securitytest` (demotion, deactivation, two devices) |
| 6 | Medium | Employees could log activity on other departments' leads, and system entries could be deleted | Department check; system entries protected | `securitytest` |
| 7 | Medium | `/api/analytics` gave employees deal money and colleagues' figures | Money only for those who may see pipeline totals; colleagues' numbers only where the visibility rules allow | `securitytest` |
| 8 | Medium | Managers could read the whole audit trail, including other departments' record diffs | Audit log is founder-only | `securitytest`, `shelltest` |
| 9 | Medium | Open redirect after sign-in (`/\evil.com`, tab tricks) | Same-origin parsing of the destination | `securitytest`, unit tests |
| 10 | Low | Deal value echoed by a no-op edit; push-endpoint SSRF; employees seeing agent runs and client timelines beyond their assignments; health endpoint leaking error text; cron GETs runnable by a founder's cookie (CSRF); CSV formula injection in the attendance export; message threads created for out-of-reach clients | Each fixed | `securitytest` (39 checks in all) |
| 11 | Hardening | Sign-in and invitations were the only rate-limited endpoints; uploads were trusted by declared type | Rate limits added on password change, vault reveal, uploads, messages, invitations and search. File contents must match their declared type. | `securitytest`, unit tests |
| — | Clean | Secrets scan (tracked files and full history); raw SQL (none unsafe); HTML emails escaped; signed downloads; vault; Stripe webhook; invitation tokens; tenant isolation (`tenanttest` 24 checks) | — | — |

**Two items judged by design, not bugs (your call to change):**
- Managers can staff people from other departments onto their projects.
  Phase 5's skills-based staffing is organization-wide on purpose, and
  joining a project grants access to that client.
- Managers see pipeline value in Leads analytics.

## 2. Performance

- **Queries per request, measured.** No N+1 anywhere: related rows are
  batched.
  - The worst cost was the settings row, read about 36 times per request,
    half of them under SQLite's write lock. It is now one memoised read.
  - Dashboard: 102 → 49 queries and 2.4 s → 0.9 s in development.
  - Analytics: 3.1 s → 0.5 s.
- **Indexes.** 17 foreign keys had no index. All now do.
- **Caching.** The Command Center is cached for 5 minutes and warmed each
  morning (Phase 8).
- **Bundles.**
  - Charts are split out of the pages that don't show them first.
  - The unused client session provider, which fetched the session on every
    page, is gone.
  - The dashboard's streaming skeleton was removed: it delayed the first
    paint behind hydration.
- **Images.** None to optimise: the only two `<img>` elements are signed
  private previews.
- **Lighthouse** (staging, production build, signed-in, per role):

| Screen | Desktop perf · a11y · best practices | Mobile perf · a11y · best practices | Mobile LCP (lab) |
| --- | --- | --- | --- |
| Sign in | 100 · 100 · 100 | 100 · 100 · 100 | 1.92 s |
| Founder dashboard | 99 · 100 · 100 | 91 · 100 · 100 | 2.95 s |
| Pipeline | 100 · 100 · 100 | 96 · 100 · 100 | 2.80 s |
| Clients | 100 · 100 · 100 | 96 · 100 · 100 | 2.80 s |
| Invoices | 100 · 100 · 100 | 96 · 100 · 100 | 2.79 s |
| Tasks (employee) | 100 · 100 · 100 | 94 · 100 · 100 | 3.11 s |
| Projects (employee) | 100 · 100 · 100 | 96 · 100 · 100 | 2.76 s |
| Portal home (client) | 100 · 100 · 100 | 97 · 100 · 100 | 2.67 s |
| Portal invoices | 100 · 100 · 100 | 96 · 100 · 100 | 2.81 s |
| Portal reports | 100 · 100 · 100 | 96 · 100 · 100 | 2.80 s |

- **Desktop LCP** is 0.53–0.95 s everywhere.
- **Mobile LCP**, under Lighthouse's simulated slow 4G with a 4× slower CPU,
  is 2.7–3.1 s, just over the 2.5 s target.
- **Main-thread blocking (TBT)** is at most 224 ms on mobile and about 0 on
  desktop, a good sign for the 200 ms INP target.
- Field numbers from real phones will settle LCP. Turning on Vercel Speed
  Insights is in the checklist.

## 3. Reliability

- **Error boundaries** exist for every route group, including sign-in, plus
  the global one. Not-found pages keep people in their own experience: a
  client never lands in the team app.
- **Panels no longer fail silently.** Timelines, drawers, fields and the bell
  now say when they failed, with a retry.
- **Retry with backoff** on email and AI calls, for transient failures only.
  Email retries carry an idempotency key, so nothing is sent twice.
- **Idempotency on money and state.**
  - Payments use idempotency keys and compare-and-set updates.
  - The staging run on Postgres found one real race: five simultaneous
    identical payments gave four 409s instead of four replays. Fixed and
    proven on Postgres.
  - Approvals, agent runs, notifications and report generation dedupe.
- **Graceful degradation.**
  - AI off → the rules path.
  - Email missing → in-app notifications only.
  - Stripe off → 404.
  - Integrations sit behind their flag.
  - Storage missing → uploads refused and health reports it.
- **Health and monitoring.**
  - `/api/health` gives anonymous callers verdicts only; the cron secret
    unlocks the detail.
  - Every scheduled job is stamped with its own lateness window.
  - A failed job notifies the founders the same day.
  - The error log is at `/admin/errors`.
  - The uptime monitor setup is in the checklist.

## 4. Accessibility

Lighthouse accessibility is **100 on every core screen**. The fixes, from a
full review of the primitives and shells:
- **Keyboard:**
  - a *Skip to content* link;
  - focus trapped in and returned from every dialog;
  - tabs with arrow keys;
  - keyboard dragging on both boards;
  - menus that manage focus.
- **Visible focus:** the ring at full strength (8:1).
- **Contrast** (the old gold-on-obsidian theme was retired in the Forest &
  Mint retheme, so the current palette was measured instead):
  - faint grey text moved to a readable step;
  - form-control edges raised to 3.3:1;
  - a text-safe red (`#B91C1C`, at least 5.4:1 everywhere); the palette's red
    stays for fills.
- **Screen readers:**
  - labels on every field;
  - charts named by their question;
  - unread state spoken;
  - correct heading order.
- **Reduced motion:** honoured everywhere, charts included.

## 5. UX completeness

- **Screen states:** loading, empty and error states were reviewed on every
  screen, and the missing ones added.
- **Portal wording, in the client's words:**
  - invoice statuses ("Due", "Partly paid", "Past due", "Cancelled");
  - report metrics ("Website visits", "Revenue per $1 of ads", "Average
    ranking");
  - notification wording;
  - stage names;
  - dates;
  - no "internal" badges on files.
- **Staff wording:** made consistent ("AI employee", "department").
- **Command palette:** now covers the whole app.
  - It can go to any screen the role may open, and start new work.
  - It finds leads, clients, projects, tasks (opening the task),
    invoices, people and AI employees.
  - It works on phones and with screen readers.
- **Responsive QA:** 375 / 768 / 1280 across all three experiences, in
  development and on staging, with no overflow, console errors or CSP
  violations.

## 6. Visual polish

Checked against §7 while fixing the above:
- **Contrast and borders:** tightened as described in §4.
- **Charts:** stay on the green scale; negatives stay gray.
- **Cards:** one hero card per view.
- **Run pages:** card headers fixed.
- **The three experiences:** consistent with each other.

No new styles were invented; everything goes through the tokens, and the
design-token tests pass.

## 7. Documentation

| Document | What |
| --- | --- |
| `README.md` | Rewritten for the current product: setup, demo accounts, environment, scripts, test suites |
| `docs/DEPLOYMENT.md` | **The launch checklist**, covering hosting, database, jobs, storage, email and secrets, with what was executed on staging |
| `docs/RUNBOOK.md` | What to watch; incidents (database down, job failed, storage, errors, email, lockouts); routine tasks; **vault key rotation** (new `npm run vault:reseal`); **backup and restore** |
| `docs/ARCHITECTURE.md` | Final for launch: security at the edge, sessions, storage, jobs, performance |
| `docs/DECISIONS.md` | ADR-020 |
| `docs/DESIGN_SYSTEM.md`, `CLAUDE.md` §7 | New tokens (`danger-ink`, `line-field`) and the accessibility rules |
| `docs/DATA_MODEL.md`, `docs/METRICS.md` | Phase 10 schema; health and job-lateness definitions; the performance budget |

## 8. Launch checklist on staging

The staging environment:
- **Build:** a production build (`vercel-build`, then `next start`).
- **Database:** a fresh **Postgres 18** cluster run just for this; it is
  independent of your own data.
- **Configuration:** exactly as the checklist sets it up.

| Step | Result |
| --- | --- |
| Migrations from zero | 14 applied; schema diff **empty** (no drift) |
| Secrets, storage, health | Configured; health `ok` apart from jobs not yet run, then each job run once by hand → OK |
| Three experiences in a browser | 22 screens × 3 widths, founder / employee / client: no console errors, no CSP violations, no overflow |
| Acceptance suites against staging | shelltest 72 · tenanttest 24 · portaltest 103 · journeytest 81 · billingtest 100 · reporttest 31 · securitytest 39 · cycletest 21 · projecttest 65 · leadtest 40 — **576 checks, all green** |
| Lighthouse | As in §2 |
| Restore rehearsal | `pg_dump` → restore into a new database → row counts identical across 10 tables; schema diff empty |
| Vault key rotation | Rotated, verified, and rotated back while the server kept revealing secrets; a wrong key changes nothing |

**What staging found (all fixed):**
- the Postgres payment race;
- a vault key missing from staging's first configuration (it's now a
  checklist row);
- health-check noise: a job that legitimately skips wasn't recorded as run,
  and provider-managed backups showed as permanently stale;
- the ended-session redirect.

## Quality gate

All green on a fresh database (development, SQLite):

- **Static:** typecheck · lint (ESLint CLI, 0 warnings, now including `scripts/`) · **980 unit tests** (+53 this phase) · production build (0 warnings) · bundle scan · `npm audit` **0** (a new `brace-expansion` advisory published during the phase was fixed the same day).
- **HTTP suites:** permtest 371 · leaks · fieldtest 45 · journeytest 81 · shelltest 72 · tenanttest 24 · daytest 28 · leadtest 40 · outreachtest 36 · projecttest 65 · assigntest 35 · portaltest 103 · billingtest 100 · analyticstest 73 · reporttest 31 · notifytest 35 · agenttest 81 · **securitytest 39** · **cycletest 21** · **storagetest 15** · smoke 161 · smoke:empty 152.
  - `permtest` counts 21 fewer checks than in Phase 9 because the client KPI endpoint now refuses three employee accounts, and it only counts checks on responses that return data.
- **Staging (production build, Postgres 18):** 10 suites, 576 checks, as in §8.
- **Browser:** 375 / 768 / 1280 across all three experiences, on development and on staging.
- **Found by the gate itself:**
  - React 19's development server sends the values that server components await into the page, for DevTools. That means a dev server can carry data a page then refuses, such as another client's invoice.
  - Production builds don't send this. The staging suite checks the whole response, and `npm run share` serves a production build.
  - `billingtest` now judges the rendered page on a dev server, and the entire response on a production build.
  - The rule is in the runbook: never show clients a dev server.

## Known limitations

- **Mobile LCP (lab)** is 2.7–3.1 s against the 2.5 s target; desktop is
  0.5–1 s. Confirm with field data once live.
- **Rate limits** are counted per server instance. A Redis limiter is a
  drop-in change if abuse ever appears.
- **Postgres row-level security** as a second wall is still future work. The
  data-layer tenancy wall is tested with a planted second organization.
  Some legacy module tables (milestones, leave, disputes) are scoped by their
  parent rather than by organization. That's fine with one agency and should
  be tightened before a second organization is onboarded.
- **Real providers.** S3 and Resend are proven against faithful local
  stand-ins, not against your accounts. The checklist's first-deploy steps
  confirm both.
- Next 16 exists. 15.5 is the supported, patched line, and moving to 16 can
  wait.

## What I need from you

1. **Accounts:** Vercel, Neon or Supabase, Cloudflare R2 or AWS S3, and
   Resend. Then `docs/DEPLOYMENT.md` takes it from there.
2. **Two policy calls** (§1): cross-department project staffing, and whether
   managers see pipeline value.
3. **Optional:** the Anthropic key (AI-written text), and Stripe when card
   payments are wanted.
