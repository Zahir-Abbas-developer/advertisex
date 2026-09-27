# Phase 5 Report — AI-Powered Project & Task Assignment

*Date: 2026-09-28 · Scope: the founder's Phase 5 prompt (`docs/PHASES.md`) ·
Status: **delivered**. Local only — nothing pushed, nothing deployed.*

## Summary

Every new project gets a team plan. However the project is created (the
Projects page, client onboarding, or winning a lead), its required skills are
worked out: from its services, with weights, plus optionally the brief, read
by AI. Each required skill becomes a role, and the best eligible person for
it is recommended with a sentence explaining why. The sentence is built from
real numbers: skills and proficiency, free capacity, on-time delivery,
leave, and other deadlines.

The founder accepts, changes or dismisses each role. A change is
audit-logged and remembered for next time. In AUTO mode the team is assigned
on creation. When workload or deadlines drift, the system raises a
"reassignment suggested" signal and never moves anyone by itself.

On the seeded team, "Website + Google Ads + SEO" staffs itself sensibly:

| Role | Recommended | Why (as shown) |
| --- | --- | --- |
| Google Ads | Tayyaba | covers 2/5 required skills · Google Ads 4/5 · 35% capacity free · 100% on-time delivery |
| SEO | Cheryl | covers 3/5 · SEO 4/5 · 45% capacity free · 100% on-time |
| Websites | Cheryl | covers 3/5 · Websites 4/5 · 30% capacity free · 100% on-time |
| UI/UX | Cam | UI/UX 4/5 · 80% capacity free (Cheryl, 3/5 and already on two roles, is the runner-up) |
| Development | Raja Zain | Development 5/5 · no delivery history yet |

**Gate note.** The founder sent the Phase 5 prompt after the Phase 4 report
and its bug sweep, without the literal "Phase 4 approved". As at every
earlier handover, I treated that as the go-ahead and recorded it in
PHASE_LOG. Phase 4's open decisions still stand.

## Design items

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1 | Requirement analysis | ✅ Skills from each service's catalog mapping, with editable weights 1–5 (Settings → Services). Optional AI reading of the brief, limited to the organization's own skill list, with an 8-second limit and a safe fallback to no extra skills. Skills added by hand. Output is a weighted list of required skills, heaviest first. | `modules/assignment/domain.ts · deriveRequirements`, `modules/ai/*` |
| 2 | Scoring | ✅ `score = w1·skillMatch + w2·availability + w3·(free capacity) + w4·performance + w5·deadlineFit`, plus the override signal. Hard constraints: must hold the role's skill at 2/5 or better, must not be on leave or inactive, and must not exceed weekly capacity. The founder sets the weights (Settings → Assignment). Every input comes from real data: skills and proficiency, capacity, open tasks and milestones, project roles, on-time history, approved leave, and deadlines. | `domain.ts · evaluate`, `server.ts · loadCandidates`, `docs/METRICS.md` |
| 3 | Output | ✅ Ranked recommendations per role, with a plain-language explanation, a score breakdown, and up to three explained alternatives. A role no one can take says why. RECOMMEND or AUTO mode. The founder can override any role (optionally saying why); overrides are audit-logged and fed back as a per-skill signal. | project → Team tab, `/api/projects/[id]/assignment/**` |
| 4 | On assignment | ✅ The person joins the project team, sees it straight away under "Your projects" on My Work (with their role), and is notified. In RECOMMEND mode the founder and the project owner are told a team is waiting. | `components/team/MyWork.tsx` |
| 5 | Rebalancing | ✅ A morning sweep, any deadline change, or "check now" raises a "reassignment suggested" signal when the holder can no longer cover the role, is over capacity, or when the project is delayed and someone is clearly better (15+ points). It is shown on the project and sent to the founders; nothing moves until they accept. | `server.ts · sweepRebalance`, `/api/projects/[id]/reassignments/[sid]` |

## How to test it

Run `npm run dev` and open http://localhost:3000.

- **As the founder:**
  - *Projects → New project*: pick Website Development, Google Ads and SEO, then *Team*.
  - Read each role's reason and score bars, then *Accept all*, or *Choose someone* to override (add a reason if you like).
  - Create a second one: the person you chose carries a "you've chosen them for this before" note.
  - *Settings → Assignment*: switch to *Assign automatically*, or change the weights and *Re-analyze* a project.
  - Existing projects show "Not analyzed yet" with a live suggestion; *Analyze team* records it.
- **As an assigned employee:** *My Work → Your projects* shows the project and your role.
- **AI (optional):** set `ANTHROPIC_API_KEY` (and optionally `AI_MODEL`) and give a project a description. Skills it mentions that the services don't cover are added as "read from the brief". Without a key, everything else works the same.
- **Automated:** `SMOKE_BASE=http://localhost:3000 npm run assigntest`.

## Acceptance

- **"Website + Google Ads + SEO" gives sensible, explainable assignments
  across the right specialists in the seeded team, verified by tests with
  fixed data.**
  - Unit tests on a fixed team put the right specialist on each of the 5 roles.
  - `assigntest` does the same over HTTP on the seeded team (35 checks), with
    the reason for each.
  - It also checks that every recommendation holds the skill, and that
    nothing happens before confirmation.
  - Accepting puts people on the project, their dashboards and their
    notifications.
  - An override is stored, audit-logged and remembered next time.
  - AUTO mode assigns on creation.
  - Weights change the outcome, and only the founder can set them.
  - An overloaded holder raises a suggestion once, the role doesn't move on
    its own, and accepting moves it.
- **Unit tests cover scoring, constraints, weights and explanation output.**
  `tests/assignment-domain.test.ts` has 21 tests:
  - requirements and weight merging;
  - normalization and fallbacks, and weights changing the winner;
  - every score component checked against hand-computed values;
  - the override signal and its cap;
  - each hard constraint;
  - the acceptance scenario, gaps with reasons, and explanation text,
    including the brief's own example ("covers 3/3 required skills · … · 40%
    capacity free · 96% on-time delivery");
  - fairness to the current holder;
  - every rebalancing trigger.

  `tests/ai-skills.test.ts` has 4 tests: only taxonomy skills are accepted,
  it is off without a provider, and it fails safe.
- **Scoring formula documented.** `docs/METRICS.md` → "Added in Phase 5 —
  project assignment".

## The gate

| Check | Result |
| --- | --- |
| `tsc` | ✓ |
| `lint` | ✓ |
| Unit tests | **826/826** |
| `build` | ✓ |
| `bundlescan` | ✓ (now also checks that the AI provider never reaches the browser) |
| `smoke` | ✓ (113) |
| `smoke:empty` | ✓ |
| `permtest` | ✓ (392) |
| `leaks` | ✓ |
| `fieldtest` | ✓ (45) |
| `journeytest` | ✓ (81) |
| `shelltest` | ✓ (72) |
| `tenanttest` | ✓ (24) |
| `daytest` | ✓ (28) |
| `leadtest` | ✓ (40) |
| `outreachtest` | ✓ (36) |
| `projecttest` | ✓ (65) |
| **`assigntest`** | ✓ (35) |

`assigntest` is in CI.

**Browser check.** I clicked through the Team plan at 1280 and 375:
accept, choose someone else, and accept all. I also checked Settings →
Assignment and Services at 1280 (and Assignment at 375), and an employee's
My Work at both widths. There were no exceptions and no overflow.

This check found a real fairness bug, now fixed and tested. Free capacity was
measured before the role for newcomers but after it for the current holder,
so a person's ranking dropped the moment their role was accepted. It is now
measured after the role for everyone. Separately, the fixed-data unit test
caught one generalist absorbing every role, which led to each role carrying
its own weekly load.

## Changed behaviour (said out loud)

- **Staffing on creation:** creating a project (from any path) now
  recommends a team and notifies the founder and the owner. In AUTO mode it
  adds people to the project.
- **Project skills carry weights:**
  - Catalog services got the 5/3/2 default weights where theirs were
    untouched.
  - Editing a project's skills keeps each skill's weight. Before, saving
    reset every skill to the default and silently lost the catalog weights.
- **Demo seed:** Cheryl now also holds SEO and UI/UX, Cam holds UI/UX, and
  Tayyaba holds SEO (at 2). New skills only, so no existing skill was
  changed.
- **My Work** gains "Your projects".
- **The morning job** also runs the rebalancing sweep.

## Needs your decision

1. **AI key** (optional): to have briefs read for skills, set
   `ANTHROPIC_API_KEY` in Vercel. The default model is `claude-sonnet-5`
   (change with `AI_MODEL`). Only the brief text and your skill names are
   sent.
2. **Default mode:** RECOMMEND is the default. Switch to AUTO in Settings →
   Assignment if you'd rather confirm afterwards.
3. **Carried from Phase 4:** the production `VAULT_KEY`, the file-storage
   bucket, what to do with any legacy retainer projects, and the Phase 3
   stage mapping.

## Known limitations

- **Tasks.** Individual *tasks* inside a project are still routed by the
  Phase 2 skill/workload rule. Phase 5 staffs the project's *roles*; its
  scoring isn't used for task routing yet.
- **Capacity estimates.** Capacity uses flat estimates: 2 hours per open item
  and 6 hours per week per role (configurable). Real task estimates would
  sharpen it.
- **Leave.** Only approved leave on specific days counts; a status of "on
  leave" excludes someone entirely.
- **Signals.** The override signal is a small nudge (±0.04 per choice, at
  most ±0.12) over 180 days. It does not learn beyond that.
- **Carried:** `smoke:browser` (the old driver's stall) and the Neon backup
  before the first deploy.

## Readiness for Phase 6

Ready. Project teams now come from a documented, tested decision with an
audit trail, `modules/ai` is in place for later AI features, and every
employee's dashboard shows the projects they're on.
