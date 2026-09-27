# Phase 4 Report — Client Management & Project Management

*Date: 2026-09-27 · Scope: the founder's Phase 4 prompt (`docs/PHASES.md`) ·
Status: **delivered**. Local only — nothing pushed, nothing deployed.*

## Summary

Each client now has one profile that holds everything about them:
- company and contact details, and a computed health indicator;
- the services they bought, at their own prices, and a billing summary;
- contracts with their signed files;
- the assigned team, and pinned "important notes";
- files, a timeline of every conversation, and reports;
- an encrypted credentials vault.

Every client can have several projects. Each project is planned from its
services' stage templates. It has a team, required skills, milestones, tasks,
files, a discussion thread and a full activity trail. Its progress comes from
one documented formula. A morning job detects delayed projects, and the
founder has a projects analytics screen.

The acceptance is checked over real HTTP by a new harness, `projecttest`
(58 checks), plus unit tests on every formula. A post-build scan shows nothing
of the vault in the browser bundle.

**Gate note.** The founder sent the Phase 4 prompt before replying
"Phase 3 approved". As at every earlier handover, I treated that as the
go-ahead, and PHASE_LOG records it. The Phase 3 report and its open decision
still stand.

## Scope, item by item

| # | Scope item | Status | Where |
| --- | --- | --- | --- |
| 1 | Client profile | ✅ Company and contact info. **Services purchased** from the catalog of 11 (Website Development … CRM Implementation), each with its own price and billing cadence (one-time, monthly, quarterly, yearly); the catalog can be extended in Settings → Services. Projects. **Contracts** (status, dates, value, signed files). **Billing summary** (monthly recurring, annual run rate, one-time, contracted — agreed figures, which is where billing will plug in). **Reports** (existing weekly reports; where reporting will plug in). **Assigned team** (account owner plus everyone on an open project). **Communication** (the full timeline; where messaging will plug in). **Credentials vault**. Project progress. **Important notes** (pinned). **Health indicator**. | `/clients/[id]` |
| 2 | Project model | ✅ Name, client, services, start, deadline, status, priority, owner and team. Required skills are derived from the services and can be edited. Tasks (the Phase 2 tasks, now attached to projects). Milestones with a weight (1–5). Progress % from the documented formula. Files, discussion thread and activity. Reports stay per client. | `Project` + new models, `/api/projects/**` |
| 3 | Stage templates per service | ✅ Each service carries an editable template (e.g. Website: Planning → Design → Development → Testing → Launch). A project gets one line of stages per service. Completing a stage starts the next one. The current stage, completed milestones and upcoming work are all shown. | Settings → Services, project Plan tab |
| 4 | Views | ✅ Projects **list** and **board** (by status), with filters and a "mine" toggle. **Project detail** (overview, plan, tasks, files, team, discussion and activity, client logins). **Founder projects analytics** (active, completed, delayed with detail, upcoming deadlines, average progress, assignments, status mix, started vs completed per month). **Delayed-project detection job** (in the morning run). | `/projects`, `/projects/[id]`, `/projects/analytics` |
| 5 | Files | ✅ Upload to a client, a project or a contract. Private storage. **Signed URLs** that last five minutes and can't be altered (HMAC over the file, the expiry and the disposition). Inline **previews** for images and PDFs, sandboxed. **Internal/external** visibility flag; a client login only ever sees files marked for the client. | `/api/files`, `/f/[id]`, `FilesPanel` |
| 6 | Notifications | ✅ **New project** (to its team). **Project update**: status, deadline or owner changed, someone added to the team, a stage completed, a milestone reached, a comment. **Deadline approaching** (7 days out, once per deadline). **Project delayed** (to the team and the founder, once per delay). | `lib/notification-types.ts`, `modules/projects/jobs.ts` |

## How to test it

Run `npm run db:reset && npm run dev`, then open http://localhost:3000. Every
account's password is `advertisex-change-me`.

The demo seed has three clients at different points in their life:
- **Osteria Nonna** has a website relaunch on track and ongoing search work.
- **Bao Society** has an Instagram launch 5 days past its deadline, and a
  contract ending in 20 days.
- **Grind Coffee Co.** has a completed brand refresh and an automation project
  that hasn't started.

Things to try:
- **Founder** (`coachd@bwm.local`):
  - *Clients* → Osteria Nonna: look at the overview, then Services & billing, Contracts (attach a PDF), Logins (reveal one, then check the audit log), and Notes.
  - *Projects* → Board and List → *Website relaunch* → Plan: complete a stage, tick a milestone, and watch progress move.
  - *Projects → Analytics*.
  - *Settings → Services*: edit a stage template or a price.
- **Employee** (`tayyaba@bwm.local`): *Projects* shows only the projects they're on. They can tick milestones and add tasks, but can't change a project's details.
- **Automated:** `SMOKE_BASE=http://localhost:3000 npm run projecttest`; after a build, `npm run bundlescan`.

## Acceptance

**Client → multiple projects → tasks → milestones → progress stays consistent.**
`projecttest` covers the chain:
- A project with two services gets exactly its templates' stages, each line
  starting at its first stage, with its skills derived.
- A second project for the same client is listed with the first.
- Milestones and tasks attach to the project, and project tasks land in the
  client's department.
- After **every** change the API's progress equals the formula recomputed
  from the database: adding work, ticking a weight-3 milestone (exactly 50%),
  completing a task, reopening, and a team member's tick.
- Completing a stage starts the next, and the current stage follows.
- Completing the project reads 100% and is dated.

**Credentials vault: encrypted at rest, never in the client bundle, access
audited, masked by default (tests).**
- Unit tests show AES-256-GCM round-trips. They also show that a secret is
  refused if moved to another record, if tampered with, or under an unknown
  key, and that key rotation works.
- `projecttest` shows:
  - the stored value is sealed, never plaintext, and never echoed back;
  - lists are masked;
  - a reveal returns the secret uncached, and every reveal writes an audit
    entry naming who did it;
  - neither the secret nor its sealed form appears anywhere in the audit log;
  - a manager of another department and a client login are refused;
  - a team member on the client's work can reveal it (audited too) but can't
    change it.
- The client-boundary test walks the import graph: no client component can
  reach the vault, and the vault modules are `server-only`.
- `bundlescan` checks the built browser bundles for the key, the key
  derivation, the cipher, the signing salt and a demo secret: none are there.
- The leak scan decrypts every stored secret and checks every GET response,
  for every non-founder role, for the secret and its sealed form: none leak.

**Progress formula documented and tested.** It is in `docs/METRICS.md`
("Added in Phase 4 — project progress and schedule"), alongside schedule,
delay, health, billing and analytics. It is unit tested in
`tests/projects-domain.test.ts` and re-checked over HTTP.

## The gate

| Check | Result |
| --- | --- |
| `tsc` | ✓ |
| `lint` | ✓ |
| Unit tests | **797/797** |
| `build` | ✓ |
| **`bundlescan`** | ✓ |
| `smoke` | ✓ (110) |
| `smoke:empty` | ✓ |
| `permtest` | ✓ (392) |
| `leaks` | ✓ (65 sentinels, including contract values and vault secrets) |
| `fieldtest` | ✓ (45) |
| `journeytest` | ✓ (81) |
| `shelltest` | ✓ (72) |
| `tenanttest` | ✓ (24) |
| `daytest` | ✓ (28) |
| `leadtest` | ✓ (40) |
| `outreachtest` | ✓ (36) |
| **`projecttest`** | ✓ (65) |

CI runs `projecttest` and `bundlescan`.

**Browser check.**
- Every new screen and every tab was loaded in Chrome at 1280. The
  client profile, projects list, project detail and analytics were also
  loaded at 375, and the projects list at 768.
- The main pages of the earlier phases were loaded at 375.
- Result: zero exceptions, no error boundaries, no horizontal overflow.
- The vault's reveal was clicked in the browser for both the founder and an
  employee.
- This check surfaced and fixed a real width bug: some pages were wider than
  a 375px phone, which the earlier checks had missed. That includes the
  Phase 2 Team directory.

## Changed behaviour (said out loud)

- **`/projects` is the new projects area**, open to all staff within their
  scope. The retainer planner pages were replaced. The retainer module's own
  pages (`/board`, `/my-tasks`) stay parked behind their flag.
- **The evaluation cron's retainer steps** (close-out, payment status,
  renewal) now run only while the retainer module is switched on. With the
  module off, which is how production runs, they already did nothing useful
  for Phase 4 projects: they would have auto-closed a late project.
- **Clients:**
  - The list and profile open to managers for their departments, without
    money or phone numbers.
  - Employees still don't get a clients list.
  - Onboarding now records the purchased services and plans the first
    project from stage templates, 90 days long.
  - Client health is the new rules-based indicator. The legacy weighted score
    needed ROAS and payment data from parked modules.
- **Service catalog:**
  - The 11 services of the brief are seeded per organization.
  - The production owner script no longer seeds the 5 legacy e-commerce
    services. Any that exist are kept and become the organization's.
- **Permissions:** new `project` and `credential` resources, and a new
  `reveal` action. Project membership now counts as assignment to that
  project and its client.
- **Project tasks** can be worked by anyone on the project team, whatever
  their department.

## Bug sweep before approval (2026-09-27)

Three independent code reviews (APIs and security; screens; data model, jobs
and seed) and a real-browser walk through every Phase 4 form found and fixed:

- **Dates showed one day early everywhere** (all phases): date-only values
  are stored at UTC midnight and were formatted on the New York clock. The
  day-level formatters now show the stored calendar day (tested).
- **Delay and deadline alerts reached only one person per project** (the
  dedupe key wasn't per recipient) — now every team member and the founder.
- **A manager's page source carried the client's recurring revenue** — now
  founder-only, like the rest of the money.
- **Legacy retainer cycles would have read as 0% and "delayed"** — they now
  show their own progress and are not schedule-judged; the retainer
  module's renewal and payment steps touch only retainer cycles; a renewed
  cycle keeps its organization.
- **Client health** used a UTC "end of day" and counted work on cancelled
  projects — now the company clock, open projects only.
- **The project activity feed missed most events** and could show a phantom
  "took someone off the team" — now matched by record, named, no phantoms.
- **Completing a later stage could leave two active stages** — the line's
  first unfinished stage is always the current one (tested).
- **Onboarding wasn't atomic** (a failure could leave a client to be
  duplicated on retry) — one transaction now; the wizard's project length,
  default dates and error step fixed.
- Employees could publish a file straight to the client on upload; deleting
  a project left its files on disk; milestone reassignment wasn't validated;
  client edits couldn't clear optional fields; stale selections on the Team
  tab could silently drop skills; the profile's figures didn't refresh after
  edits; cancelled projects were missing from the board; several saves
  could leave a spinner stuck on a network failure; cards were double
  padded; a few smaller issues (search case, blank prices, retired skills,
  duplicate-slug false errors, missing FK indexes).

`projecttest` now has 65 checks (per-recipient alerts, first-unfinished
stage, activity feed, employee file sharing). Unit tests 797.

**Not changed, on purpose:** the 5 legacy e-commerce services in production
stay in the catalog next to the new ones (retire them in Settings → Services
if unwanted — changing live catalog data is your call); the activity feed
searches the audit log by text, which is fine now and should get an index
when the log grows large.

## Needs your decision

1. **The vault key for production.** Generate it with `openssl rand -base64 32`,
   set `VAULT_KEY` in Vercel, and keep a copy in your password manager.
   Without it, production refuses to store or open credentials. If it's lost,
   the stored credentials can't be recovered.
2. **File storage provider.** Files are private with signed URLs, but they
   still sit on local disk, which Vercel doesn't keep. Pick a bucket
   (S3, Cloudflare R2 or Vercel Blob) and I'll swap the store behind the same
   signed-URL contract.
3. **Legacy retainer projects in production**, if any exist. They'll show in
   `/projects` with an empty plan (0%, "nothing planned"). I can map their
   workstreams and milestones into stages and milestones with a dry-run
   script, or leave them. Separately, the retainer module's code can now be
   deleted, which D4 allows once this replacement ships, but only with your
   approval.
4. **Carried from Phase 3:** whether to move existing departments onto the
   standard pipeline stages.

## Known limitations

- **File persistence on Vercel.** See decision 2.
- **Client portal.** The client portal doesn't show projects or files yet; the
  visibility flag is enforced in the API, ready for the portal phase.
  Communication is the internal timeline and project thread; messaging with
  the client arrives in the messaging phase.
- **Billing and reports.** The billing summary shows agreed figures, not
  invoices, until the billing phase. Reports lists the existing weekly
  reports until reporting is rebuilt.
- **Board.** The projects board groups by status; status changes happen on the
  project, not by dragging.
- **`smoke:browser`.** It is still not green: this is the hand-written driver's
  stall, carried from Phase 1. Every screen was checked in a real browser as
  described above.
- **Production backup.** The Neon backup before the first deploy is still
  outstanding (carried).

## Readiness for Phase 5

Ready. Clients have accounts, and files have a client-visibility flag that is
enforced and tested. Projects, their progress and their stages are computed
in one place, so a client-facing view can show the same numbers the team
sees.
