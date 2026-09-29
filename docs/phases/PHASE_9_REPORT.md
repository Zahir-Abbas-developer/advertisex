# Phase 9 Report — AI Employees · Agent Framework · Automated Workflows

*Date: 2026-09-29 · Scope: the founder's Phase 9 prompt (`docs/PHASES.md`) ·
Status: **delivered**. Local only — nothing pushed, nothing deployed.*

## Summary

AI employees now do real work in the CRM, under the same rules as people:

- **Six agents.** Each is an `AI_AGENT` user with one capability:
  - Atlas: lead research.
  - Sage: lead qualification.
  - Quill: follow-up preparation.
  - Ledger: client report drafting.
  - Pulse: internal notifier.
  - Lens: task creator.
- **Background work.** Agents work in the background on leads, clients,
  projects or the whole agency.
- **Logged and audited.** Every step is logged, and every tool call is
  audited with its inputs and outputs, in the agent's name.
- **Usage and cost.** Tokens and cost are recorded on every run.
- **People decide consequential actions.** Anything that reaches a client,
  closes a deal, bills money or publishes a report is only proposed. It
  waits in **Approvals** until a founder or the department's manager
  decides. Approving carries it out as that person.
- **Automations.** The founder writes rules: *when* a lead is created, a lead
  changes stage, a task's deadline nears or a client's report is due, *then*
  give an agent the work, notify people, or create a task. Three are seeded.
  "Qualify every new lead" is on.
- **Visibility.** **AI employees** (`/agents`) shows each agent's work log
  and performance: work completed, approval rate, waiting, failed, and spend
  (spend is hidden from employees). An agent's team profile and Team
  performance show the same figures. Agents have no attendance.
- **Safety.**
  - Rate limits defer work rather than drop it.
  - A monthly budget turns the model off, and the agent carries on with its
    rules.
  - Contact details and secrets never reach a model.
  - Website text is treated as data, and instructions hidden in it are
    detected and ignored.
  - The fetcher can't be pointed at internal addresses.

**Gate note.** The founder sent the Phase 9 prompt after the Phase 8 report
without the literal "Phase 8 approved". As at every earlier handover, I
treated that as the go-ahead and recorded it in PHASE_LOG.

## Scope items

| # | Item | Status | Where |
| --- | --- | --- | --- |
| 1 | Agent framework | ✅ **Structure.** An agent is an AI_AGENT user + an `AgentProfile` naming one capability. A capability declares its subject, its typed tools, its limits and a `run`. There are 13 typed tools over our own data layer, each naming the permission it needs, and the agent's grant is checked per call against the target's organization and department.<br>**Runs.** Runs are background jobs (`AgentRun` is the queue; claimed with a lease; in-process worker + `/api/cron/agents` + the morning job). Each run executes *as the agent*, so tenancy scoping and the data-layer audit apply to it.<br>**Logging.** Every tool call is an `AgentStep` and an `AGENT_ACTION` audit row with inputs and outputs.<br>**Usage.** Every model call's tokens and cost (integer micro-dollars) are added to the run. | `modules/ai/agents` |
| 2 | Human-in-the-loop approvals | ✅ **Proposal-only tools.** Four consequential tools only propose: send a client message, mark a lead won/lost, create an invoice, publish a report.<br>**Queue.** Proposals go to the review queue (`/approvals`), and reviewers are notified.<br>**Who decides.** Founders decide anything; managers decide for their departments; invoices are founder-only.<br>**Approving.** Approving executes the action through the same code people use, as the approver. A decision is made once and is audited. | `/approvals`, `approvals.ts` |
| 3 | First agents | ✅ **Lead Qualification (Sage).** A repeatable 0–100 score from five factors, with a model-written rationale and next step, on the lead's timeline, plus a fit tag. A cold lead idle 45+ days is *proposed* as lost.<br>**Lead Research (Atlas).** Reads the lead's website into offer, signals and gaps.<br>**Follow-up Preparation (Quill).** Drafts the next touch as a task for the owner.<br>**Client Report Drafting (Ledger).** Drafts the monthly report and proposes publishing it.<br>**Internal Notifier (Pulse).** Posts a what-needs-attention summary to the founders.<br>**Task Creator (Lens).** Turns a project brief into its first tasks.<br>**Without AI.** Every agent has a deterministic path when AI is off, over budget or failing. | `capabilities/*` |
| 4 | Automation rules engine | ✅ **Triggers:** lead created, stage changed, deadline near, report due. Each is emitted by the code that owns the moment.<br>**Actions:** give an agent the work, notify (owner / managers / founders), create a task.<br>**Conditions:** department, source, target stage kind.<br>**Behaviour.** Each rule fires once per occasion, and emitting never fails the caller.<br>**Editing.** Founder-only, from the UI. | `/automations`, `automations.ts` |
| 5 | Agent visibility in team views | ✅ **Where.** `/agents` (roster, performance, work log with filters); the run page (every step, its input and output, approvals, usage); an agent's team profile ("AI work"); Team performance ("AI employees").<br>**Measures.** Work completed and approval rate. No attendance. | `/agents`, `/agents/runs/[id]`, `/team/[id]`, `/team/performance` |
| 6 | Safety | ✅ **Rate limits** per rolling hour (deferred, not dropped).<br>**Monthly budgets** (the model switches off; rules continue).<br>**PII minimization:** tools return no contact details, and every prompt is redacted.<br>**No secrets in prompts:** API keys, tokens and vault values are stripped.<br>**Prompt injection:** external text is wrapped as untrusted data, scanned, and never able to choose an action, because code decides and the model only writes validated text.<br>**Fetching:** public http(s) addresses only, redirects re-checked, DNS checked. | `safety.ts`, `runner.ts`, `tools.ts` |

## How to test it

Run `npm run dev` and open http://localhost:3000.

- **As the founder** (`coachd@bwm.local`):
  - **Pipeline → new lead.** Within seconds Sage qualifies it: the score and
    its reasons are on the lead's timeline.
  - **AI employees** shows the run in the work log. Open it to see every
    step with what went in and out, and the cost.
  - **Give work** on an agent's card: pick a lead, client or project.
  - **Approvals** is where proposals wait. **Automations** is where rules
    are made, switched off or deleted.
  - **Hire an agent** gives a new agent a capability.
- **As the manager** (`rajazain@bwm.local`): Approvals for your departments.
- **As an employee** (`cam@bwm.local`): AI employees and their work, without
  spend.
- **With AI:** set `ANTHROPIC_API_KEY` and rationales and drafts are
  model-written; without it, everything works on rules.
- **Automated:** `npm run agenttest` (80 checks). The server must run with
  `AI_PROVIDER=fake AGENT_FETCH_ALLOW_PRIVATE=true`, as CI does.

## Acceptance

- **An AI employee visibly completes a real task end-to-end, with audit and
  approval where required.**
  - `agenttest` creates a lead over HTTP. The seeded rule queues Sage, who
    scores it with a model-written rationale, notes it on the timeline and
    tags it.
  - Every tool call is audited as Sage, with inputs and outputs, and the
    data layer's own audit names Sage for the change. Tokens and cost are on
    the run.
  - A 90-day-cold lead gets a *proposal* to close it as lost, and nothing
    moves until a manager approves. The move is then made in the manager's
    name, and the stage-change automation fires. A rejection changes
    nothing.
  - Report drafting goes from the report-due automation, through the worker
    endpoint, to an approval and on to publication.
- **Adding a new agent requires only a new capability definition —
  demonstrated.**
  - *Client Check-in* was added in its own commit: one file
    (`capabilities/client-check-in.ts`) and one line in `registry.ts`. No
    schema, tools, routes or UI.
  - In `agenttest`, the founder hires "Iris" with it over the API. She
    receives exactly the two grants her tools need, drafts a progress update
    for a project's client, and waits. On approval, the message is posted to
    the client's conversation from the founder.
- **Definition of Done passes** — see the gate below.

## Quality gate

All green, on a fresh database:

- **Static checks.** typecheck · lint (0 warnings) · **962 unit tests** (35 new) · build (0 warnings) · bundle scan (nothing of the AI provider, vault, payments or PDF engine in the browser).
- **HTTP harnesses.**
  - smoke: 161 checks, 57 routes × 3 roles; smoke:empty: 152.
  - permtest 392 · leaks · fieldtest 45 · journeytest 81 · shelltest 72 · tenanttest 24 · daytest 28 · leadtest 40 · outreachtest 36 · projecttest 65 · assigntest 35.
  - portaltest 103 · billingtest 100 · analyticstest 73 · reporttest 31 · notifytest 35 · **agenttest 80**.
- **Browser.** `/agents`, a run page, `/approvals`, `/automations`, an agent's team profile and Team performance at 375 / 768 / 1280, as founder and as employee. No horizontal scroll, no console errors, no error boundary. Fixed from it: card header padding on the run page, "Cold" instead of "COLD", and plain-language automation outcomes instead of run ids.
- **Along the way.**
  - The first full run found three harness interactions with the new default rule. They are fixed: leadtest now expects the lead's tags as converted; reporttest and notifytest no longer run agents in their own process.
  - It also found an import cycle, stage move → automations → runner → tools → stage move. It made one route's dev compile balloon from 937 to 2,279 modules, and it stalled. Splitting the queue from the runner removed it.
- **Your data.** Your database and uploads were backed up before the reset and restored after; every password is byte-for-byte unchanged.

## Changes worth knowing

- **Approval reviewers.** Reviewers are founders plus the department's
  *managers by role*. A team lead who is an employee isn't asked to decide
  something they can't.
- **Actor stores are process-wide.** The stores holding "who is acting" now
  live on `globalThis`. Otherwise an agent's writes from a run started in a
  request were attributed to the person who made the request (found by the
  harness).
- **`moveLeadStage`** now emits the stage-change event after a move.
- **Other events.** Lead creation (`POST /api/leads`), the morning deadline
  sweep and the monthly report job also emit events. The morning job drains
  the agent queue.
- **Harness setup.** `agenttest` calls the server's event emitters directly,
  so it loads with `scripts/lib/allow-server-only.mjs`, which stubs
  `server-only` for that process only.

## Known limitations

- **Worker on serverless.** Runs start in-process. On a serverless host a
  run can be frozen when the response ends, and it is then picked up by
  `/api/cron/agents` or the morning job. On the Hobby plan that's daily; a
  more frequent schedule (Pro, or an external pinger) makes it prompt. The
  seam for a real queue is `runner.ts`.
- **Report cost.** The monthly report's own AI summary (Phase 8) is not
  counted in Ledger's run cost; that call happens inside the report
  generator.
- **No new triggers or actions from the UI.** Triggers and actions are the
  four and three listed. Adding one is code.
- **One capability per agent.** To do two jobs, hire two agents.
- **Research reads one page.** It doesn't crawl a site.

## Readiness for Phase 10

The framework is general: capabilities, typed tools, grants, approvals,
budgets and automations are all in place.

**Needs the founder:**
- The Anthropic key, for model-written rationales and drafts.
- Whether "Qualify every new lead" stays on by default.
- The per-agent budgets (defaults: $1–3 a month each).
