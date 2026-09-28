# Phase 6 Report — Client Portal & Client–Team Communication

*Date: 2026-09-28 · Scope: the founder's Phase 6 prompt (`docs/PHASES.md`) ·
Status: **delivered**. Local only — nothing pushed, nothing deployed.*

## Summary

Each restaurant client now has its own portal. It covers the client's
projects and where they stand, the updates the team chose to share, its
monthly reports, its plan and invoices, and a conversation with the team.
There is also a private line to the founders.

Nothing in the portal comes from a general-purpose API. Every page is built
from allow-listed views, internal content is filtered out in the query, and
another client's anything is simply "not found". A new harness,
`portaltest` (103 checks), proves this over HTTP on every portal page and
API.

Logins are invite-only. The founder or a manager invites a client's owner
from the client profile, and an owner can invite colleagues as members. The
link works once, for 7 days.

**Gate note.** The founder sent the Phase 6 prompt after the Phase 5
report, without the literal "Phase 5 approved". As at every earlier handover,
I treated that as the go-ahead and recorded it in PHASE_LOG.

## Scope items

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1 | Client auth | ✅ Invite-only (`ClientInvite`: hashed single-use token, 7 days, claimed atomically, rate-limited accept). A login belongs to exactly one account, with the role OWNER or MEMBER. Staff invite from Client → *Portal access*; owners invite members from *Settings*. Emailed when SMTP is set, otherwise a copyable link. | `/invite/[token]`, `modules/portal/server.ts` |
| 2 | Overview | ✅ Greeting, project cards with progress, what's coming up, what's new (shared updates, new reports), services, and a message shortcut. | `/portal` |
| 3 | Project progress | ✅ A stage tracker per service, the current stage, milestones (title and date only), a "done so far" list, shared updates, notes from the team (comments marked for the client), and shared files. Updates, comments and files each carry an internal/client flag, internal by default. Only the founder or a manager can share. Sharing an update tells the client. | `/portal/projects/[id]`; team side: project → *Updates* tab |
| 4 | Reports | ✅ A library grouped by month, filterable by type, with open and download (signed 5-minute links), an unread dot, and "opened by" on the team side. Manual path: Client → *Reports* → upload, publish, withdraw, delete. Publishing tells the client. | `/portal/reports`, `ClientReportsPanel` |
| 5 | Invoices | ✅ Read-only and owner-only, with the agreed plan (services and prices). Invoices come through one seam (`invoicesForAccount`), which is empty until Phase 7, and the page says so plainly. | `/portal/invoices`, `modules/billing/portal.ts` |
| 6 | Messaging | ✅ A TEAM thread and a private FOUNDER channel per client; file attachments; "Seen" receipts; unread counts; notifications (respecting the client's preferences); a 15-second refresh. The founder sees every thread. Staff see TEAM threads only for clients their permissions cover. No one but founders sees the founder channel. | `/portal/messages`, `/messages`, client → *Messages* |
| 7 | Client settings | ✅ Profile (name, phone), password, notification preferences (messages, reports, updates), and people: an owner invites members, withdraws invitations and removes members. | `/portal/settings` |

## How to test it

Run `npm run dev` and open http://localhost:3000.

- **As the client** (`marco@osterianonna.example`):
  - *Overview*: the Website relaunch project, its shared update and the August report.
  - *Projects → Website relaunch*: stages, milestones, the update "Your homepage design is approved". The internal update about the booking widget is not there.
  - *Reports*: open the August report; its unread dot goes.
  - *Messages*: the conversation about the brunch menu, and *Private — founders*.
  - *Settings*: invite a colleague and copy their link. Open it in a private window to accept.
- **As the founder** (`coachd@bwm.local`):
  - *Messages*: every client's threads, including the founders' channel.
  - *Clients → Osteria Nonna*: the *Messages*, *Reports* and *Portal access* tabs.
  - A project → *Updates*: post an update, tick "Share with the client", and see it in the portal.
- **As an employee** (`tayyaba@bwm.local`): *Messages* shows Osteria Nonna's team thread, not the founders' channel.
- **Automated:** `SMOKE_BASE=http://localhost:3000 npm run portaltest`.

## Acceptance

- **Isolation tests: a client can never read or write another client's
  projects, files, reports, invoices or messages, including via direct IDs
  and URLs.** `portaltest` creates two clients' logins through real
  invitations, then has client A try client B's:
  - project page and project API;
  - report (open by id), report list, project files (list, download, change);
  - message attachment, thread (read, post) and threads by client id;
  - people and invoices;
  - every staff API (projects, comments, updates, client, credentials, reports, portal users, lists).

  All are refused, and B can still reach its own things, so the refusals are
  isolation, not breakage. Tenancy unit tests cover each new model.
- **Internal-only content never renders in the portal.** The harness creates
  an internal update, comment, file, milestone note, task, client note,
  credential and draft report. It then reads all 7 portal pages and 9 portal
  APIs (including every thread) as the client and finds none of them. The
  shared counterparts do appear. Sharing an update makes it appear, and
  making it internal again removes it. The portal also can't read the raw
  comment or update streams. `tests/portal-views.test.ts` checks the
  allow-list serializers.
- **The portal is responsive and premium.** Same Obsidian & Gold system as
  the rest of the product, in plain client language. Checked in a browser at
  375, 768 and 1280 (see below).
- **Definition of Done.** See the gate.

## The gate

| Check | Result |
| --- | --- |
| `tsc` | ✓ |
| `lint` | ✓ |
| Unit tests | **849/849** (new: portal views, Phase 6 tenancy scoping, the public invite route in the route-guard test) |
| `build` | ✓ |
| `bundlescan` | ✓ |
| `smoke` | ✓ |
| `smoke:empty` | ✓ (122) |
| `permtest` · `leaks` · `fieldtest` · `journeytest` · `shelltest` · `tenanttest` · `daytest` · `leadtest` · `outreachtest` · `assigntest` | ✓ |
| `projecttest` | ✓ (65). It failed once in the full sequential run while the dev server was heavily loaded, then passed three times in a row on its own. I didn't capture which check failed, so I'm reporting it rather than calling it a proven flake. |
| **`portaltest`** | ✓ (103) |

`portaltest` is in CI.

**Browser check.** All 7 portal pages (as the client) and the team's Messages, a project's Updates tab and the client profile (as the founder), each at 375, 768 and 1280: no horizontal overflow and no console errors (30 of 30). At 375 the portal's tab bar scrolls sideways to reach Invoices and Settings.

## Changed behaviour (said out loud)

- **Client logins** now carry a role. Existing ones become OWNER (seed
  backfill), so nothing they could see is lost; they gain the new pages.
- **Project comments** gain a visibility flag. Existing comments are
  internal, as they always were; a client never saw them and still doesn't.
- **The client profile's** "Communication" tab is now *Messages* (the
  conversation, then the contact history). The old reports list is now the
  *Reports* library.
- **The team sidebar** gains *Messages* for everyone.
- **Demo seed:** Osteria Nonna gets a conversation, a founders' message, a
  shared and an internal update, and a published August report. It is added
  once and skipped when messages already exist.

## Needs your decision

1. **Email:** invitations and notifications are emailed only when SMTP is
   set (`SMTP_*`, `APP_URL`). Without it, the inviter copies the link.
   Which provider do you want for production?
2. **Who can share with the client:** the founder and managers (the
   brief's reading). Should senior employees be able to share too?
3. **Carried:** Phase 5's AI key and default mode, and Phase 4's `VAULT_KEY`,
   storage bucket, legacy retainers and stage mapping.

## Known limitations

- **Messages** refresh every 15 seconds rather than instantly. The data
  model is ready for real-time delivery.
- **One conversation per client** plus the founders' channel. Per-project
  threads are supported by the model (`projectId`) but not yet offered in
  the UI.
- **Invoices** are empty until Phase 7 fills the seam.
- **Reports** are uploaded by hand; automated reports (Phase 8) will use
  the same library.
- **Another client's project page** answers with the "not available" view
  and HTTP 200 rather than 404, because the portal's loading screen streams
  the response (ADR-015). Nothing of the other client is in it; the API
  answers 404.
- **Carried:** `smoke:browser` and the Neon backup before the first deploy.

## Readiness for Phase 7

Ready. The invoices page, its owner-only rule and its API are final, and
read from one function that billing will fill. Clients can already be
notified and messaged about invoices through the same channels.
