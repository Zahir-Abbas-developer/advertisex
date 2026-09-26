# Phase 3 Report — Lead Pipeline & Outreach Tracking

*Date: 2026-09-26 · Scope: the founder's Phase 3 prompt (`docs/PHASES.md`) ·
Status: **delivered**. Local only — nothing pushed, nothing deployed.*

## Summary

The CRM pipeline is now a complete sales system. Leads carry every field the
prompt lists. The board runs on the standard stages, with drag-and-drop that
also works from the keyboard, a table view, filters, saved views and search.
Every stage move is recorded, so the founder's analytics can show a real
funnel and stage velocity. Outreach is counted straight from what people log
on each lead, per person and company-wide, by day, week and month. A lead
becomes a client, a portal account and a first project in **one transaction**,
with nothing typed twice. Leads can be imported and exported as CSV, with
validation and duplicate detection.

The acceptance criteria are checked over real HTTP by two new harnesses:
`leadtest` (40 checks) and `outreachtest` (36 checks).

**Gate note.** The founder issued the Phase 3 prompt after the Phase 2 report,
without the literal "Phase 2 approved". I treated that as the go-ahead and
recorded it in PHASE_LOG.

## Scope, item by item

| # | Scope item | Status | Where |
| --- | --- | --- | --- |
| 1 | Lead model | ✅ Business, contact, email, phone, **website, location, industry** (restaurant segments), source (8 values incl. Other, plus a **custom source** detail), owner, deal value, stage, notes, **tags**, lost reason, timestamps. | `Lead`, `modules/leads/domain.ts`, lead form and drawer |
| 2 | Stages, board, table, filters, views, search | ✅ New Lead → Contacted → Qualified → Meeting → Proposal → Negotiation → Won / Lost. Drag-and-drop with a **keyboard sensor** (Space to lift, arrows, Space to drop). Board and Table tabs. Filters: stage, source, owner, value range, created dates, tags, search. **Saved views** per person. Global search (⌘K) includes leads. | `/pipeline`, `LeadFilterBar`, `LeadTable`, `/api/views` |
| 3 | Follow-ups | ✅ Schedule, due, complete, snooze. "Follow-ups due" (today and overdue) shows on the employee's My Work and on the founder dashboard. Morning reminders via notifications (existing cron, deduped). | `/api/follow-ups`, `lib/tasks.ts`, `/api/cron/follow-ups` |
| 4 | Communication history | ✅ A timeline per lead: calls, emails sent and replied, follow-ups, meetings booked and held, proposals, notes, plus system entries (stage changes, assignment, deal closed). Filterable by type. | lead drawer, `/api/activities` |
| 5 | Outreach tracking | ✅ The eight outreach kinds, counted from logged activities. Daily, weekly and monthly rollups. The founder sees each person and the company, a manager their departments, an employee only their own. Tiles show the current day, week or month; the tables show the whole window. | `/outreach`, `modules/outreach/domain.ts` |
| 6 | Founder leads analytics | ✅ Total, new, contacted, qualified, follow-ups, meetings booked, converted, lost, conversion rate, pipeline value. Charts: weekly trend, by source, funnel, stage velocity. Every definition is in METRICS. Founder and managers only. | `/pipeline/analytics`, `/api/leads/analytics` |
| 7 | Convert Lead → Client + Project | ✅ One action, one transaction: ClientAccount, Client with every lead field (department answers copied), first Project with the selected services, lead history linked to the client, lead marked Won, optional client-user invite (temporary password, forced change), explicit `LEAD_CONVERTED` audit entry. Converting twice → 409. Lost → reopen first. | `ConvertDialog`, `modules/leads/convert.ts` |
| 8 | CSV import / export | ✅ Export respects the current filters, uses formula-safe cells and is capped at 10,000 rows. Import runs **preview then commit**. Every row is validated. Duplicates are found against existing leads and within the file, and are skipped unless chosen. Owner and stage are checked against the department. Founder and managers only. | `ImportLeadsModal`, `/api/leads/import`, `/api/leads/export`, `modules/leads/csv.ts` |

## How to test it

Run `npm run db:reset && npm run dev`. Every account starts with the password
`advertisex-change-me`. The demo seed now includes 48 leads spread across every
stage, each with its history and outreach.

- **Founder** (`coachd@bwm.local`):
  1. Open *Pipeline* and drag a card. Or tab to a card's handle, press Space, use the arrows, then press Space again.
  2. Switch to *Table*, filter, then *Save view*.
  3. Open a lead, log a call, then choose *Convert to client*: pick services, optionally invite the owner, confirm. The client and project are ready under *Clients*.
  4. Visit *Pipeline → Analytics* and *Outreach*.
  5. Use *Export* and *Import*. Upload a CSV, read the preview, then commit.
- **Employee** (`tayyaba@bwm.local`):
  1. *Dashboard* shows "Follow-ups due".
  2. *Outreach* shows only your own numbers.
  3. *Pipeline → Analytics* is refused.
- **Automated:** set `SMOKE_BASE=http://localhost:3000`, then run `npm run leadtest` and `npm run outreachtest`.

## Acceptance

- **Lifecycle end to end, no re-entry.** `leadtest` creates a lead with
  department answers and moves it through every stage, checking each stage
  event. It logs activity and converts the lead. It then asserts that the
  client, account, project, services, copied fields and answers, linked
  history, Won stage, DEAL_CLOSED entry and audit entry all exist, and that
  the invited user must change their password. A second conversion is
  refused, and a lost lead can't be converted. It also runs CSV round trips
  and duplicate detection, saved views, and the permission refusals.
- **Fast with 1,000+ leads.** `leadtest` adds 1,200 leads to one department.
  The board still answers in **under 40 ms** (26–39 ms across runs), and table page 10 in under 30 ms,
  from a dev server. The board loads 50 cards per column with true totals and
  a "load more" per column.
- **Outreach reconciles exactly.** `outreachtest` logs a known number of each
  type. The rollups rise by exactly that number for the day, week and month,
  in the employee's view and in the founder's per-person view. The buckets add
  up to the total, which equals the database's own count. An employee asking
  for someone else's numbers gets only their own. The pure rollup is pinned
  by `tests/outreach-domain.test.ts`.

## The gate

`tsc` ✓ · `lint` ✓ · unit **725/725** · `build` ✓ · `smoke` ✓ ·
`smoke:empty` ✓ · `permtest` ✓ (322) · `leaks` ✓ · `fieldtest` ✓ (45) ·
`journeytest` ✓ (81) · `shelltest` ✓ (70) · `tenanttest` ✓ (24) ·
`daytest` ✓ (28) · **`leadtest` ✓ (40)** · **`outreachtest` ✓ (36)**. CI runs
both new harnesses.

Browser check: the new screens have zero exceptions, no error boundaries and
no horizontal overflow. That covers the pipeline at 375, 768, 1280 and 1536;
the table; analytics and founder outreach at 1280 and 375; employee outreach
and My Work at 1280. It surfaced two fixes, both made:

- The outreach tiles summed a 12-week window under a "Weekly" label.
- Header actions were clipped at 375.

`smoke:browser` itself is still the open item from Phase 1.

Isolation: `LeadStageEvent` is scoped through its lead's department, and
`SavedView` is an organization root readable only by its owner. Both are in
the tenancy unit tests. `tenanttest` and `permtest` still pass with the new
routes.

## Changed behaviour (said out loud)

- **Stages.** New departments, and fresh databases, get the standard stages.
  Existing departments keep theirs (see the decision below).
- **Conversion.** The old path (open the client wizard pre-filled, then link)
  is gone, along with its API. Conversion is the one-action dialog.
- **Logging activity.** Only the new types can be logged: Cold call, Email
  sent, Email reply, Follow-up, Meeting booked, Meeting held, Proposal sent,
  Note, Other. Old CALL/EMAIL/MEETING/QUOTE history still displays and still
  counts.
- **Snoozing a follow-up** writes a Note, not a Follow-up, so postponing
  doesn't count as outreach.
- **New leads are checked for duplicates** (same email, or same name plus
  phone). The form shows the match with a "Create anyway" option. Emails are
  now stored lowercased.
- **Audit entries** written inside a multi-record transaction are now saved
  after it commits, and dropped if it rolls back. Those entries carry the new
  values but no "before" image.
- **Demo seed.** Lead monthly values are now distinct, non-round numbers. The
  leak scanner matches them exactly, and a value of 404 collided with the
  "404" in ordinary page text.

## Needs your decision

**Moving existing departments onto the standard stages.** Production
departments keep their current stage names. On those departments everything
works — board, conversion, outreach, velocity — except the analytics
**funnel** and the **Contacted / Qualified** counts, which read the standard
stages. Switching them means renaming stages under live leads: a data change
on a populated table, so it is your call. The proposal is a one-off,
dry-run-first mapping script (old stage → standard stage), run after a backup
exactly like the role backfill. I have not built it without your approval.

## Known limitations

- **Attachments still don't persist on Vercel.** The S3-compatible file store
  wasn't in the Phase 3 scope and is still pending (carried from Phase 2).
- **`smoke:browser` is not green.** This is the known stall in the
  hand-written Chrome driver's role switch, unchanged. The new screens were
  checked directly (above).
- **The import is capped** at 5,000 rows and 2 MB per file, and is written in
  one transaction. Larger files should be split.
- **The board loads 50 cards per column.** Counts and values are for the
  whole column. Drag-and-drop between columns only reaches loaded cards.
- **Communication is logged by hand.** Email and calendar adapters are a later
  phase, as the prompt says.
- **Production still needs the Neon backup** before the first deploy
  (carried).

## Readiness for Phase 4

Ready. A won lead now arrives as a ClientAccount with its first Project,
services and (optionally) its portal user. Whatever comes next for clients,
projects or billing starts from real records instead of a hand-off.
`transaction()` gives any multi-record write, money included, one audited
commit.
