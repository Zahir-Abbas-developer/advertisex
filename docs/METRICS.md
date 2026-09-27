# Metrics — every formula behind every number

*Initialized in Phase 0. Rule: no number renders on any screen unless its formula
is written here first and computed in one owned module. Phases append their
formulas at the gate.*

## Already implemented (inherited, verified)

| Metric | Formula | Owner |
| --- | --- | --- |
| Conversion rate | `won / (won + lost)` — open deals excluded from the denominator; `null` (not 0) when nothing closed | `lib/analytics.ts · conversionRate()` (unit-tested) |
| Revenue (range) | Σ `dealValue` of leads whose stage has kind WON/ACTIVE_CLIENT **and** whose stage move falls in range — dated by the move, not creation | `lib/analytics.ts · metricsFor()` |
| Open pipeline | Σ `dealValue` over stages of kind OPEN, per department | `lib/analytics.ts` |
| Commission | `round(dealValue × commission_rate% )`, derived at read time wherever a department defines a `commission_rate` field — never stored. None of the D2 service lines defines one today; `journeytest` re-arms its check the moment one does | `lib/stages.ts · commissionsFor()` |
| Task bucket | OVERDUE if now > end of due day *on the company clock*; TODAY if due-day ≤ company-today; else UPCOMING — DST-correct | `lib/tasks.ts · bucketFor()` (unit-tested incl. DST boundary) |
| Pending follow-ups | count of leads (unconverted) + clients with `nextFollowUpAt ≤ company-today` | `lib/tasks.ts` / `lib/analytics.ts` |
| Assignment score | whole-word skill overlap with context terms, then lowest open-lead count, then dept-lead, then name — ranking is a hint, never a filter | `lib/matching.ts`, `lib/auto-assign.ts` (unit-tested) |
| Due deadline | end of the due calendar day in the company timezone, offset computed per-instant via Intl (never a constant) | `lib/date.ts · dueDeadline()` (unit-tested) |
| On-time rate (parked module) | `completed ≤ dueDeadline / completed`, all-time | dashboard, moves with D4 |
| Client health, scoring ledger, MRR (parked) | see module code; formulas migrate here if D4 unparks them | `lib/clientHealth.ts`, `lib/scoring.ts`, `lib/kpi.ts` |

## Added in Phase 1 — client portal (`/portal`)

| Metric | Formula | Owner |
| --- | --- | --- |
| Active projects | count of `Project` with status PLANNING or ACTIVE whose CRM `Client` belongs to the viewer's own `ClientAccount` **and** organization | `app/(client)/portal/page.tsx` |
| Reports shared | count of `Report` rows whose `Client` belongs to the viewer's own `ClientAccount` and organization | `app/(client)/portal/page.tsx` |
| Open invoices | not computed — shown as "—" until billing exists (P4); no placeholder number is ever rendered | — |

Both counts are scoped twice: by the query (client-own) and by the tenancy
wall in the data layer (organization).

## Added in Phase 2 — attendance (`modules/attendance/domain.ts`)

All attendance arithmetic happens on the **employee's own wall clock**: the
schedule names an IANA timezone, and every "which day", "how late", "how
early" is evaluated there, DST-correct. Pinned by
`tests/attendance-domain.test.ts`.

| Metric | Formula |
| --- | --- |
| Schedule | work days (ISO weekdays), start and end (minutes past local midnight), grace minutes. Default Mon–Fri 09:00–17:00, 5 min grace, company timezone. |
| Break minutes | Σ over breaks of the overlap between the break and the worked span; an open break counts up to clock-out (or now while in progress). |
| Worked minutes | `(clock-out or now) − clock-in − break minutes`, never below 0. |
| Late minutes | on a scheduled day, if arrival (local minute) > start + grace: `arrival − start` (measured from the start, not from the end of grace); else 0. Never late on an unscheduled day. |
| Early-departure minutes | on a scheduled day with a same-day clock-out: `max(0, end − departure)`. Not counted while in progress. |
| Day status | ON_LEAVE (approved leave, no clock-in) · OFF (unscheduled, not worked) · UPCOMING (scheduled, not over, no clock-in) · ABSENT (scheduled, day over — date past, or today after the scheduled end — no clock-in) · IN_PROGRESS (clocked in, not out) · LATE (worked, late > 0) · PRESENT (worked, on time). |
| Attendance rate | days worked on scheduled days ÷ (scheduled days elapsed − leave days); `null` before any such day. |
| Punctuality rate | (days worked − late days) ÷ days worked; `null` when nothing was worked. |
| Hours worked vs scheduled | Σ worked minutes · Σ (end − start) over scheduled days. |

## Added in Phase 2 — tasks and performance (`modules/tasks/domain.ts`)

Pinned by `tests/tasks-domain.test.ts`.

| Metric | Formula |
| --- | --- |
| Status flow | NOT_STARTED → IN_PROGRESS → REVIEW → COMPLETED; one step forward or back, straight to COMPLETED from anywhere, COMPLETED reopens only to IN_PROGRESS. Legacy OPEN/DONE read as NOT_STARTED/COMPLETED. |
| Deadline | the end of the due calendar day on the company clock (`lib/date.ts · dueDeadline`). |
| Overdue | open and now > deadline. |
| Deadline approaching | open and deadline − now ≤ 24 hours. |
| On-time delivery rate | tasks completed at or before their deadline ÷ tasks completed that had a deadline; `null` when none qualify (no work is not bad work). |
| Workload | open tasks × 2 estimated hours ÷ weekly capacity hours; may exceed 100% — overload is shown, not clipped. `null` without capacity. |
| Tasks completed / overdue | counts over the selected period, by `completedAt` / by overdue state now. |
| Projects delivered | distinct projects with status COMPLETED and `closedOutAt` in the period, on which the person had a task (`Task.projectId`) or a milestone. |
| Period ("this month") | from the first of the month to the first of the next, both at 00:00 on the **company** clock (`modules/team/server.ts · monthBounds`) — a task finished at 22:00 New York time on the 31st counts in that month. Attendance months use each person's own clock. |
| Team totals | pooled from each person's own counts: team on-time rate = Σ completed on time ÷ Σ completed with a deadline; team punctuality = (Σ days worked − Σ late days) ÷ Σ days worked. Never an average of per-person rates. |

Attendance and performance are **computed and displayed separately**. No
composite score is shown in Phase 2; if one is ever added it must be labelled
a weighted composite with its weights on screen (Phase 2 prompt, scope 6).

## Added in Phase 3 — outreach (`modules/outreach/domain.ts`)

Pinned by `tests/outreach-domain.test.ts` and, over HTTP, by `outreachtest`
(the logged activities and the rollups must agree exactly).

Every outreach number is a **count of `SalesActivity` rows**; nothing is stored
pre-aggregated. Each row counts toward exactly one kind, or toward none:

| Kind | Activity types counted |
| --- | --- |
| Cold calls | `COLD_CALL`, legacy `CALL` |
| Emails sent | `EMAIL_SENT`, legacy `EMAIL` |
| Emails replied | `EMAIL_REPLY` |
| Follow-ups | `FOLLOW_UP` |
| Meetings booked | `MEETING_BOOKED` |
| Meetings completed | `MEETING_HELD`, legacy `MEETING` |
| Proposals sent | `PROPOSAL_SENT`, legacy `QUOTE` |
| Deals closed | `DEAL_CLOSED`, written once, by the system, the first time a lead is won; attributed to the lead's owner (the actor if unowned) |

`NOTE`, `OTHER`, `STATUS_CHANGE` and `ASSIGNMENT` never count. A snoozed
follow-up writes a `NOTE`, not a `FOLLOW_UP`: postponing is not outreach.

| Metric | Formula |
| --- | --- |
| Bucket | by `occurredAt` on the **company** calendar: the day; the week starting **Monday**; the calendar month. |
| Per person | rows grouped by `userId` (who logged it). |
| Company-wide | Σ over people. Reconciliation invariant: Σ buckets = Σ people = total = number of outreach rows counted. |
| Range | whole company calendar days (`rangeFromQuery`); default 30 days (daily), 12 weeks (weekly), 12 months (monthly); at most three years. The tiles show the bucket "now" falls in, with the whole range beneath. |
| Visibility | employee: their own rows only (a `userId` parameter is ignored); manager: their departments; founder: the company. |

## Added in Phase 3 — leads analytics (`/api/leads/analytics`)

Range: `from`–`to`, whole **company calendar** days (`lib/date.ts · rangeFromQuery`; default the last 90 days). Founder: every department (or
one); manager: their departments.

| Metric | Formula |
| --- | --- |
| New leads | leads with `createdAt` in range. |
| Contacted / Qualified | distinct leads with a `LeadStageEvent` into that stage in range (so a lead that skips a stage is not counted for it). |
| Converted | leads with `convertedAt` in range. |
| Lost | distinct leads with a stage event into a LOST-kind stage in range. |
| Conversion rate | converted ÷ (converted + lost) in range — decided deals only; open leads are not failures yet. `null` when nothing was decided. |
| Pipeline value | Σ `dealValue` of leads currently in an OPEN-kind stage. |
| By source | per source: leads created in range, and leads converted in range. |
| Funnel | per standard stage: distinct leads that entered it in range. |
| Stage velocity | per stage: mean time from entering it to the lead's next stage event, in days to one decimal, over every completed stay in the lead's history (`stageVelocity`). A stay still in progress is not a sample. |
| Weekly trend | new leads and conversions per Monday-start week on the company calendar; every week in the range appears, empty ones as zero. |
| Follow-ups / meetings booked | the outreach counts above, over the range. |

## Added in Phase 4 — project progress and schedule (`modules/projects/domain.ts`)

Pinned by `tests/projects-domain.test.ts`, and over HTTP by `projecttest`,
which recomputes the formula from the database after every change and
requires the API to agree.

**Progress %** — in one sentence: *the share of the project's planned work
that is done, where each milestone counts by its size and each task counts 1.*

| Case | Formula |
| --- | --- |
| Work planned | ⌊ 100 × (Σ weight of done milestones + done tasks) ÷ (Σ weight of all milestones + all tasks) ⌋. Weight is 1–5 (clamped). |
| Nothing planned yet, stages exist | ⌊ 100 × done stages ÷ stages ⌋ |
| Nothing at all | 0 |
| Project COMPLETED | 100 |

Rounded **down**, so 100% only ever means every item is done. The same
number feeds the project page, the lists, the client profile, analytics and
client health.

| Metric | Formula |
| --- | --- |
| Deadline | end of the deadline's calendar day on the company clock (`dueDeadline`). |
| Expected progress | share of the start→deadline span already elapsed, 0–100. |
| Schedule | CLOSED if completed or cancelled; OVERDUE if now is past the deadline; BEHIND if progress < expected − 25 points (not for ON_HOLD, which isn't expected to move); otherwise ON_TRACK. |
| Delayed | OVERDUE or BEHIND. |
| Days overdue | ⌈ (now − deadline) ÷ 1 day ⌉, 0 when not past. |
| Current stage | per service line, the first stage in order that isn't DONE. |
| Upcoming work | open milestones and tasks due within 14 days, overdue first, soonest first. |

**Delayed-project job** (morning cron, `modules/projects/jobs.ts`): a project
newly found delayed is stamped `delayedAt` and its team plus the founder are
notified once; when it recovers the stamp clears, so a later slip is news
again. A project due within 7 days (and not delayed) warns its team once per
deadline date.

## Added in Phase 4 — client health (`modules/clients/health.ts`)

Rules, not a weighted score: every band lists the facts that put it there.
Pinned by `tests/projects-domain.test.ts`.

| Band | When |
| --- | --- |
| At risk | any open project more than 7 days past its deadline; or 2+ delayed projects; or on-time delivery below 60% (with at least 5 completed items) |
| Watch | one delayed project; any overdue milestone or task; on-time delivery below 85% (≥ 5 items); a signed or active contract ending within 30 days, or past its end date |
| Healthy | none of the above |

*On-time delivery* = milestones and tasks completed by the end of their due
day ÷ milestones and tasks completed that had a due date.

(The legacy weighted health — delivery, ROAS, payment, blocked days — belongs
to the parked retainer and KPI modules and is no longer shown.)

## Added in Phase 4 — billing summary (client profile, founder only)

| Metric | Formula |
| --- | --- |
| Monthly recurring | Σ over ACTIVE purchased services of the monthly equivalent: monthly price; quarterly ÷ 3; yearly ÷ 12; one-time 0 (rounded to whole dollars). |
| Annual run rate | monthly recurring × 12 |
| One-time work | Σ price of one-time services not ENDED |
| Contracted | Σ value of SIGNED and ACTIVE contracts |

Agreed figures, not invoices. Invoicing arrives with billing.

## Added in Phase 4 — projects analytics (`/api/projects/analytics`)

Founder: every project. Manager: their departments' clients' projects.

| Metric | Formula |
| --- | --- |
| Active | projects PLANNING, ACTIVE or ON_HOLD (legacy OVERDUE_CLOSEOUT reads as COMPLETED) |
| Completed | projects COMPLETED |
| Delayed | active projects whose schedule is OVERDUE or BEHIND |
| Upcoming deadlines | active projects whose deadline falls within the next 14 days |
| Average progress | mean progress % of active projects (a plain mean — each project counts once) |
| Assignments | per person: active projects they own or are on, and the open milestones and tasks assigned to them inside those projects |
| Monthly trend | per company-calendar month, last 6: projects started (by start date), completed (by `completedAt`) |

## Added in Phase 5 — project assignment (`modules/assignment/domain.ts`)

Pinned by `tests/assignment-domain.test.ts` (fixed data, including the
"Website + Google Ads + SEO" scenario) and over HTTP on the seeded team by
`assigntest`.

**Requirements.** Each required skill is a *role*, with a weight 1–5:

| Source | Weight |
| --- | --- |
| A service's skills (catalog) | as set per service; defaults by list position: first 5, second 3, others 2 |
| Read from the brief by AI (only skills in the taxonomy) | 2 |
| Added by hand on the project | 3 |

A skill from several sources keeps its highest weight. Roles are filled
heaviest first.

**Score**, per candidate per role (each component 0–1; weights `w` are the
founder's, normalized to sum to 1 — defaults 40/10/20/20/10):

    score = w1·skillMatch + w2·availability + w3·freeCapacity + w4·performanceHistory + w5·deadlineFit  (+ signal)

| Component | Formula |
| --- | --- |
| skillMatch | 0.7 × proficiency in the role's skill ÷ 5 + 0.3 × (Σ weights of the project's skills they hold at ≥ 2) ÷ (Σ all weights) |
| availability | 1 − approved leave days in the project's first 14 days ÷ 10; 0 if on leave or inactive |
| freeCapacity (the brief's 1 − workloadRatio) | 1 − committed hours *after taking the role* ÷ weekly capacity, clamped 0–1. Committed = 2 h × (open tasks + open project milestones) + role hours × (open projects they're on + roles already given to them in this plan). A newcomer adds one role's hours; a current holder's role is already counted — the same measure for both. |
| performanceHistory | on-time rate of tasks and milestones completed in the last 180 days that had a due date (done by the end of the due day, company clock); 0.6 with no history (neutral, not a penalty) |
| deadlineFit | 1 − (2 h × open items due on or before this project's deadline) ÷ (weekly capacity × weeks from start to deadline, at least 1) |
| signal | per skill, over 180 days: +0.04 for each time the founder chose this person over the recommendation, −0.04 each time they were overridden away; capped ±0.12 |

Role hours default to 6 per week (Settings → Assignment).

**Hard constraints** — never ranked: proficiency in the role's skill below
2/5; employment status on leave or inactive; no weekly capacity; committed
hours after taking the role above weekly capacity.

**Output.** Per role: the best eligible candidate, up to three ranked
alternatives, and a sentence built from the same numbers, e.g. *"Best match:
covers 3/5 required skills · SEO 4/5 · 45% capacity free · 100% on-time
delivery."* (additions when relevant: leave in the first two weeks, other
deadlines first, the founder's past choices, AI agent). A role no one can
take says why: nobody holds the skill (a gap), or who holds it and why they
are unavailable.

**Rebalancing** (morning job, on deadline changes, or on demand) raises a
"reassignment suggested" — never a change — when the holder: no longer
holds the skill or is unavailable; is over capacity (committed > weekly
capacity); or the project is delayed and another eligible candidate scores
at least 15 points (0.15) higher. Deduped per project, role, holder,
suggestion and week.

## To be defined at their phase gates

- **P2** — per-organization aggregates (same formulas, org-scoped denominators).
- **P3** — client-visible progress % (definition must be explainable to a client in one sentence).
- **P4** — invoice totals, MRR (real, replacing the parked snapshot version), collection rate, overdue aging buckets.
- **P5** — integration metrics normalization (spend, impressions, ROAS from provider data), AI task cost.
- **P6** — attendance/performance formulas, if D4 unparks them (the legacy formulas are documented in `docs/legacy/BWM_CLAUDE.md` §Parked modules and the module code).
