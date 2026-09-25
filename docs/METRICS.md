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
| Commission (Affiliates) | `round(dealValue × commission_rate% )`, derived at read time from the department's own `commission_rate` field — never stored | `lib/stages.ts · commissionsFor()` |
| Task bucket | OVERDUE if now > end of due day *on the company clock*; TODAY if due-day ≤ company-today; else UPCOMING — DST-correct | `lib/tasks.ts · bucketFor()` (unit-tested incl. DST boundary) |
| Pending follow-ups | count of leads (unconverted) + clients with `nextFollowUpAt ≤ company-today` | `lib/tasks.ts` / `lib/analytics.ts` |
| Assignment score | whole-word skill overlap with context terms, then lowest open-lead count, then dept-lead, then name — ranking is a hint, never a filter | `lib/matching.ts`, `lib/auto-assign.ts` (unit-tested) |
| Due deadline | end of the due calendar day in the company timezone, offset computed per-instant via Intl (never a constant) | `lib/date.ts · dueDeadline()` (unit-tested) |
| On-time rate (parked module) | `completed ≤ dueDeadline / completed`, all-time | dashboard, moves with D4 |
| Client health, scoring ledger, MRR (parked) | see module code; formulas migrate here if D4 unparks them | `lib/clientHealth.ts`, `lib/scoring.ts`, `lib/kpi.ts` |

## To be defined at their phase gates

- **P2** — per-organization aggregates (same formulas, org-scoped denominators).
- **P3** — client-visible progress % (definition must be explainable to a client in one sentence).
- **P4** — invoice totals, MRR (real, replacing the parked snapshot version), collection rate, overdue aging buckets.
- **P5** — integration metrics normalization (spend, impressions, ROAS from provider data), AI task cost.
- **P6** — attendance/performance formulas, if D4 unparks them (the legacy formulas are documented in `docs/legacy/BWM_CLAUDE.md` §Parked modules and the module code).
