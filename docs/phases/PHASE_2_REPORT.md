# Phase 2 Report — Team Operating System

*Date: 2026-09-26 · Scope: the founder's Phase 2 prompt (`docs/PHASES.md`) ·
Status: **delivered**. Local only — nothing pushed, nothing deployed.*

## Summary

Advertise X now runs the team: one model for humans and AI agents, skills with
proficiency, a professional time clock measured against each person's own
schedule and timezone, tasks with a four-step lifecycle, checklist, comments,
files and full history, a calm My Work home for employees, and a founder view
of team performance where delivery and attendance are measured separately and
every number has its definition one click away.

The acceptance day-in-the-life runs end to end over real HTTP (`daytest`,
28/28). Every formula is in `docs/METRICS.md` and pinned by unit tests.

**Gate note.** The founder said "complete phase2 task" after Phase 1 was
delivered, without the literal "Phase 1 approved"; treated as the go-ahead and
recorded in PHASE_LOG. Phase 1's report still stands for review.

## Scope, item by item

| # | Scope item | Status | Where |
| --- | --- | --- | --- |
| 1 | Employee model + profile | ✅ Humans and agents are `User`s (type from role). Title, departments, skills (1–5), responsibilities, weekly capacity, schedule, status. Profile: info, skills, current projects and tasks, completed tasks, performance, attendance (or an agent's capabilities), working hours, activity. Founder edits in place. | `/team/[id]`, `/api/employees/[id]` |
| 2 | Skills taxonomy | ✅ The 17 listed skills, grouped by category, seeded per organization; founder adds, renames, deactivates. | `Skill`, `/api/skills` |
| 3 | Attendance | ✅ Clock in/out, breaks, hours, late and early against a per-employee schedule in its own timezone, absence, daily and monthly history, monthly summary, founder team view with CSV export. 28 unit tests incl. DST and timezone. | `modules/attendance`, `/my-attendance`, `/attendance` |
| 4 | Tasks | ✅ Not started → In progress → Review → Completed, enforced server-side; priority, due date, description, checklist, comments, attachments (`File`), full history from the audit log; optional project link. Overdue detection as a scheduled job. | `modules/tasks`, task drawer on `/tasks` |
| 5 | Employee dashboard | ✅ My Work (overdue, priority, due this week, projects, workload) and My Performance (tasks and projects completed, on-time rate, hours, attendance). | `/dashboard` for non-founders |
| 6 | Founder team analytics | ✅ Delivery and attendance per person and team-wide, in separate sections, each with "How this is calculated". Team rates pooled, not averaged. **No composite score** — its weights would be a founder decision (ADR-011). | `/team/performance` |
| 7 | Activity history | ✅ Employee and task feeds read the audit log (attendance, breaks, skills, schedule, checklist, comments, files now audited), rendered as sentences. | `modules/team/server.ts · activityFor` |
| 8 | Notifications | ✅ Task assigned (create and reassign), comment on your task, deadline approaching, overdue — the last two from the morning job, deduped. | `modules/tasks/deadlines.ts` |

## How to test it

`npm run db:reset && npm run dev`; every account starts with
`advertisex-change-me`.

- **Employee** (`tayyaba@bwm.local`): lands on My Work → *Time clock* → Clock
  in, take a break, clock out → *Tasks* → open a task → move it through each
  status, tick the checklist, comment, attach a file, read its History.
- **Founder** (`coachd@bwm.local`): *Team* (directory: people, then AI agents
  with their own treatment) → a person → profile; *Team performance*;
  *Attendance* → Export CSV.
- **Agent profile**: *Team* → Pulse — capabilities, no attendance.
- Automated: `SMOKE_BASE=http://localhost:3000 npm run daytest`.

## Acceptance

- **Day in the life** — `daytest` 28/28: clock in (second clock-in refused) →
  task created and seen → illegal jump refused → every status → checklist,
  comment, history → break → clock out; founder sees +1 completed task and +1
  day worked in team performance, today's row in the CSV, the clock-in and the
  task moves in the activity feed; employees are refused team data and profile
  edits.
- **Every formula documented and tested** — `docs/METRICS.md` Phase 2
  sections; `tests/attendance-domain.test.ts` (28), `tests/tasks-domain.test.ts`
  (14), Phase 2 permission tests in `tests/authorize.test.ts`.
- **AI agents distinct** — own section in the directory, "AI agent" badge and
  indigo treatment (not gold), no attendance anywhere (asserted in `daytest`),
  capability list on the profile.

## The gate

`tsc` ✓ · `lint` ✓ · unit **675/675** · `build` ✓ · `smoke` ✓ ·
`smoke:empty` ✓ · `permtest` ✓ · `leaks` ✓ · `fieldtest` ✓ · `journeytest` ✓
(73) · `shelltest` ✓ (70) · `tenanttest` ✓ (24) · `daytest` ✓ (28).
`smoke:browser` — **still the open item from Phase 1** (see below). Direct
browser checks of all seven new screens at 1280 (and My Work at 375): zero
exceptions, no error boundaries, no horizontal overflow.

## Changed behaviour (said out loud)

- Non-founders now land on **My Work**; the old member dashboard is gone.
- `/team/[id]` is the new profile; the parked scoring profile no longer
  renders there (the scoring module stays parked).
- `/team`, `/attendance` and Team performance open to managers (their
  departments); account management stays founder-only.
- Attendance is on for everyone; the legacy random availability checks,
  outage reports and leave endpoints remain parked.
- Task statuses: `OPEN`/`DONE` read as Not started/Completed until
  `npm run roles:backfill -- --apply` (now also covers tasks) runs after
  deploy.

## Known limitations

- **Attachments don't persist on Vercel** — local-disk store until the
  S3-compatible store (P3). The `File` model is ready for it.
- **`smoke:browser` not green** — stalls between roles in the hand-written
  Chrome driver; worsened by macOS throttling of detached processes. Needs the
  driver's role switch replaced (or Playwright, which needs a decision on a new
  dependency).
- Leave has no new request/approval UI (existing leave data is honoured as
  ON_LEAVE); the legacy leave flow is parked.
- One working span per day (split shifts later, no schema change needed).
- Workload uses a flat 2-hour estimate per open task; task estimates would
  sharpen it.
- Deadline notifications run once each morning (Vercel Hobby: daily crons).

## Readiness for Phase 3

Ready. Tasks carry an optional project link for Phase 4, files have the
visibility flag the client portal will need, and the permission model already
has CLIENT scoping for portal features.
