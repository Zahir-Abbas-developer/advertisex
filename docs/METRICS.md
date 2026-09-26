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

## To be defined at their phase gates

- **P2** — per-organization aggregates (same formulas, org-scoped denominators).
- **P3** — client-visible progress % (definition must be explainable to a client in one sentence).
- **P4** — invoice totals, MRR (real, replacing the parked snapshot version), collection rate, overdue aging buckets.
- **P5** — integration metrics normalization (spend, impressions, ROAS from provider data), AI task cost.
- **P6** — attendance/performance formulas, if D4 unparks them (the legacy formulas are documented in `docs/legacy/BWM_CLAUDE.md` §Parked modules and the module code).
