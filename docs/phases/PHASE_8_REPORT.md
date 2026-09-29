# Phase 8 Report — Command Center · Client Analytics · Reports · Notifications

*Date: 2026-09-29 · Scope: the founder's Phase 8 prompt (`docs/PHASES.md`) ·
Status: **delivered**. Local only — nothing pushed, nothing deployed.*

## Summary

The platform now runs on its own data:

- **Command Center.** The founder's dashboard now opens with it: leads,
  outreach, revenue, projects and the team for any period, each figure
  against the period before. There's one chart per question, and an
  announcements panel.
- **Analytics hub** (`/analytics`). It gathers every analytics page and adds
  client retention and outstanding payments by age.
- **Client results.** Each client has a Results tab: Google Ads, Meta,
  leads & bookings, website traffic, SEO and Local SEO, month against month,
  with rates derived from the raw figures. Results are entered by hand today.
  The adapters for all five platforms exist behind one interface, and live
  sync is switched off until it's built.
- **Monthly reports.** They draft themselves in the first days of each month
  (or on demand), as a branded PDF and an in-app report, with an AI-written
  summary when AI is configured. A person reviews and approves each one;
  only then does it reach the client's portal, and the client is told.
- **Notifications.** A complete system: a notification center for the team
  and for clients, email through Resend (or SMTP), per-category preferences,
  an optional daily digest, and founder announcements. Delivery is
  role-aware by construction.

Every Command Center and hub figure is recomputed from the database by
`analyticstest` and matches. A monthly report goes from generation to the
portal in `reporttest`. Every listed notification fires, to exactly the
right people, in `notifytest`.

**Gate note.** The founder sent the Phase 8 prompt after the Phase 7 report
and the Forest & Mint retheme, without the literal "Phase 7 approved". As at
every earlier handover, I treated that as the go-ahead and recorded it in
PHASE_LOG.

## Scope items

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1 | Founder Command Center | ✅ Leads (new, won, won value, conversion, open pipeline, by source), outreach (by kind, by person), revenue (received, invoiced, MRR, outstanding, overdue, trend), projects (active, delayed, milestones on time), team (tasks completed, on time, overdue, attendance, top five). KPI tiles with deltas, trend charts and breakdowns across six periods, each compared with the equal span before. Aggregated in one call (~200 ms), cached five minutes (~20 ms), warmed each morning. | founder `/dashboard`, `/api/command` |
| 2 | Internal analytics pages | ✅ The hub links revenue & sales, leads & conversion, outreach, team productivity, attendance and project delivery (existing pages, each labelled with its question), and adds client retention and outstanding payments by age. | `/analytics` |
| 3 | Client analytics framework | ✅ A metric model per channel: Google Ads, Meta (ads and social), leads & bookings (conversions), website traffic (GA4), SEO (Search Console), Local SEO (Business Profile). Stored integers, derived rates, source precedence. Adapters for all five providers behind `modules/integrations/analytics`: the interface, a deterministic mock, OAuth URL builders, and live sync behind `INTEGRATIONS_LIVE`. Manual entry is the working path; monthly results are the unit. | client → **Results** tab |
| 4 | Monthly reports | ✅ Generated per client per month from results, project progress and highlights. The summary is AI-written via `modules/ai` when configured and guarded against invented numbers; otherwise it comes from a template. A branded PDF and an in-app report render from one frozen snapshot. Every report is a draft that needs review: reviewers are notified, can edit the summary (the PDF re-renders), and approve, which publishes it and tells the client. The monthly job runs in the first five days of each month and is idempotent. | client → Reports, `/portal/reports/[id]` |
| 5 | Notification system | ✅ Notification center (team and portal), email via Resend or SMTP with a per-notification delivery record and retries, per-category preferences (off / in the app / in the app and by email; billing and announcements can't be muted below in-app), optional daily digest, founder announcements (everyone / team / clients). Every listed event fires. `notify()` enforces the audience by role for every emitter. | `/notifications`, `/portal/notifications`, bell |

## How to test it

Run `npm run dev` and open http://localhost:3000.

- **As the founder** (`coachd@bwm.local`):
  - The **dashboard** opens on the Command Center. Change the period: every tile shows its change against the span before.
  - **Analytics** shows retention and what's owed, by age.
  - **Clients → Osteria Nonna → Results** shows six months of (demo) results. Try *Enter results*: your figures replace the demo ones, and the rates follow.
  - **Clients → Osteria Nonna → Reports → Generate report** drafts it. *Review* shows it exactly as the client will read it; edit the summary if you like, then *Approve and publish*.
  - Send an **announcement** from the dashboard.
- **As the client** (`marco@osterianonna.example`):
  - **Reports → Read** opens the report in the portal, and the PDF downloads.
  - The **bell → All notifications**; **Settings** has the notification preferences and the digest.
- **Automated:** `npm run analyticstest`, `npm run reporttest` and `npm run notifytest`.

## Acceptance

- **Dashboards render from real seeded data with no placeholder numbers;
  charts follow §7.**
  - `analyticstest` recomputes every Command Center figure from the
    database for three periods, including each comparison, and checks
    they match: new leads, deals won and value, outreach, payments, the
    revenue trend, outstanding, overdue, MRR, projects and tasks.
  - It also checks that every breakdown and trend sums to its headline,
    that no figure is missing, and that the cache returns identical
    numbers. The retention cohort and the receivables aging are reconciled
    the same way.
  - The client results are the seed's six months, labelled "demo data"
    wherever they show.
  - The charts use the green scale, one question per title, with gray for
    anything lower.
- **A monthly report generates end-to-end for a seeded client and appears in
  the portal.** `reporttest` (31 checks) covers:
  - Generation: the report is generated for Osteria Nonna and its figures
    equal the stored results. Nothing internal is in it.
  - Before approval: it's invisible to the client, and the library's plain
    Publish refuses it.
  - Review: an edit re-renders the PDF, approval publishes it, and the
    client is told.
  - In the portal: the in-app report and the PDF download both work.
  - Isolation: another client can't open it.
  - The monthly job is idempotent and does nothing mid-month.
- **Every listed notification fires in tests and respects permissions.**
  `notifytest` (35 checks) fires all 11 events through the app: task
  assigned, new project, deadline approaching, task overdue, new client
  message, new report, new invoice, payment received, payment overdue,
  project update and founder announcement. It then checks:
  - client B, a manager of another department, and the (employee) account
    lead receive none of what they shouldn't;
  - `notify()` itself refuses billing to an employee and team work to a
    client;
  - muting works, and minimums hold;
  - the center filters by category and unread;
  - email is delivered to a local Resend stand-in, and the daily digest
    goes only to those who asked for it.

## The gate

| Check | Result |
| --- | --- |
| `tsc` · `lint` | ✓ · ✓ |
| Unit tests | **927/927**. New: the notification catalog (7), Command Center arithmetic, retention and aging (6), the client metric model, mock, OAuth links and the report guard (8), the download header (1), and tenancy and boundary additions. |
| `build` · `bundlescan` | ✓ · ✓ |
| `smoke` · `smoke:empty` | ✓ (152) · ✓ (143) |
| `permtest` · `leaks` · `fieldtest` · `journeytest` · `shelltest` · `tenanttest` · `daytest` · `leadtest` · `outreachtest` · `projecttest` · `assigntest` · `portaltest` · `billingtest` | ✓ (392 · — · 45 · 81 · 72 · 24 · 28 · 40 · 36 · 65 · 35 · 103 · 100) |
| **`analyticstest`** · **`reporttest`** · **`notifytest`** | ✓ (73) · ✓ (31) · ✓ (35). Each passes twice in a row, so each cleans up after itself. |

All three new suites are in CI.

**One note on the leak scan.** In the full sequential run, the Next.js *dev*
server restarted itself on reaching its memory limit (after compiling most
routes). The leak scan lost its connection mid-sign-in. It passed when re-run.
The shared harness session now waits and retries once on a refused
connection, never on an HTTP error, so a dev-server restart can't read as a
failure. The same thing caused the leak-scan hiccup during the retheme.

**Browser check.** I checked every new screen at 375, 768 and 1280 as the founder, the account
lead and the client: the dashboard with the Command Center, Analytics, a
client's Results and Reports tabs, both notification centers and their
settings, the portal's reports library and the in-app report (48 in all).
The check found and fixed three real problems:
- **Tab mismatch.** Opening a client with `?tab=` (the link in a review
  notification) rendered one tab on the server and another in the browser.
  The tab is now decided on the server.
- **Mobile overflow.** The notification center's filters overflowed at 375.
  They are now on their own row.
- **Wrong direction label.** Report tiles said "Lower than last month" when
  spend had risen. The label described whether the change was better, not
  which way the number moved. Tiles now say "Up" or "Down" on last month,
  coloured green when that's an improvement and gray otherwise.

The last run is clean: no overflow, no console errors, no hydration
warnings.

## Changed behaviour (said out loud)

- **The founder's dashboard** opens with the Command Center; the existing sections follow it.
- **Navigation:** the founder gets **Analytics**. The bell has *All notifications* (the team's `/notifications`, the client's `/portal/notifications`).
- **Notification preferences** are now per category for everyone. Clients' Phase 6 on/off choices carry over. Portal Settings uses the same preferences panel.
- **Emails:** with Resend or SMTP configured, notifications are emailed per preference (defaults: tasks, deadlines, messages, reports, billing and announcements by email; projects, sales and system in the app only).
- **Client profile:** a new **Results** tab. The Reports tab gains *Generate report* and a review step for generated reports.
- **Client status:** marking a client churned now records when (`churnedAt`); existing churned clients were backfilled from their last change.
- **Bug fixed:** downloading a file whose name has a non-Latin character (an em dash, "Menú", an emoji) failed with an error. It now downloads with its exact name.
- **Demo seed:** six months of results for the three restaurants, labelled demo data. It is added once.

## Needs your decision

1. **Live data:** to switch on Google Ads, Meta, GA4, Search Console and Business Profile, we need a Google Cloud project (OAuth client ID and secret, and a Google Ads developer token, which Google must approve) and a Meta app (ID and secret, after Meta's app review). The OAuth links are built; the sync calls come next. Until then, enter results by hand.
2. **Email:** set `RESEND_API_KEY` and `EMAIL_FROM` (with a verified sending domain) to turn on notification and invoice emails.
3. **AI summaries:** with `ANTHROPIC_API_KEY` set (carried from Phase 5), report summaries are AI-written; without it they're written from a template. Either way, a person approves every report.
4. **Who reviews reports:** today it's the founders, the department's managers and the account lead (the account lead is notified but can't approve). Is that right?
5. **Carried:** Phase 7's billing address, Stripe and tax rule; the earlier phases' items.

## Known limitations

- **Live sync isn't built** for any provider yet (intended: "feature-flagged for later"). Results come from manual entry, or demo data in development.
- **Results are monthly.** Daily granularity is reserved in the model for live syncs.
- **Attendance on the Command Center is this month against last month,** whatever the period. The team module computes attendance by month.
- **Email is sent in the request that triggers it** (bounded to 8 seconds, then retried each morning). A queue can replace this without changing any caller.
- **The Command Center is the founder's.** Managers keep their department-scoped analytics pages.
- **Carried:** `smoke:browser` and the Neon backup before the first deploy.

## Readiness for Phase 9

Ready. Client results, reports and notifications are in place, and
`modules/integrations/analytics` has the seams live data will plug into.
