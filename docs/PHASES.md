# Phases

> The founder's phase prompts, verbatim, as they are issued. This file was
> named in CLAUDE.md §2 before it existed; Phase 0 ran without it (recorded in
> ASSESSMENT and PHASE_LOG). The Phase 1 prompt below was issued 2026-09-25,
> after the Phase 0 gate — it supersedes the Phase 1 proposal in ASSESSMENT
> §11 where they differ. Reconciliation notes live in PHASE_LOG and DECISIONS,
> not here: this file stays the founder's words.

---

## PHASE 1 — FOUNDATION: REBRAND · MODULAR ARCHITECTURE · MULTI-TENANCY · AUTH · RBAC · DESIGN SYSTEM · APP SHELLS

Prerequisite: "Phase 0 approved." Read CLAUDE.md, docs/ASSESSMENT.md, docs/ARCHITECTURE.md, docs/DATA_MODEL.md.

### OBJECTIVE
Lay the production foundation everything else builds on. After this phase the app IS Advertise X: correct multi-tenant data foundations, secure auth with roles, permissions enforced on the server, the full design system, and three working app shells — with every "preserve" feature from Phase 0 still working.

### SCOPE
1. Rebrand: name, logo placeholder, metadata, page titles, transactional email templates, favicon, all copy → "Advertise X · AI Marketing Solutions for Restaurant Businesses". Remove all Metroctopus and department-specific branding while preserving reusable functionality.
2. Modular structure per CLAUDE.md §5: migrate existing code into feature modules WITHOUT changing behavior. Record every move in the report.
3. Core schema + migrations: Organization, User, Membership, Role/Permission (matrix in config/permissions.ts), ClientAccount (skeleton), AuditLog, Notification (skeleton), File (skeleton). Tenancy keys on every tenant table. Indexes on all foreign keys.
4. Tenant-scoped data-access layer (repositories). No raw unscoped queries anywhere. Add Row-Level Security if the database supports it.
5. Auth: the chosen provider integrated; roles carried in the session; invite-only user creation (admin-issued); password policy; rate-limited login; protected route groups (auth) (admin) (team) (client).
6. Authorization: an authorize() helper enforced in every server action and route handler; the permissions matrix; scope rules (own / assigned / client-own / department). Tests proving: a CLIENT cannot read another client's data; an EMPLOYEE cannot read unassigned client data; MANAGER scope holds; FOUNDER has full access; an AI_AGENT is restricted to explicit grants.
7. Design system: §7 tokens as CSS variables + Tailwind theme; typography; base components — Button, Input, Select, Textarea, Checkbox, Card, Table, KPI tile, Badge, Tabs, Dialog, Sheet, Dropdown, Tooltip, Toast, Skeleton, EmptyState, Command palette shell, Sidebar nav, Topbar, Avatar, Pagination. Write docs/DESIGN_SYSTEM.md. Add a dev-only /design-system route showcasing every component and token.
8. Three app shells: Admin (command-center layout), Team (execution layout), Client (simplified layout) — navigation, user menu, notifications bell (skeleton), responsive behavior. Each shell renders a placeholder dashboard built from real components.
9. Audit logging utility wired into the data layer for all mutations.
10. Observability: structured logging, error boundaries, Sentry (or equivalent), designed global error and not-found pages.
11. Seed: 1 organization (Advertise X), 1 founder, 1 manager, 5 human employees, 5 AI-agent users, 3 client accounts with 1 client user each — realistic restaurant names and data.

### OUT OF SCOPE
Attendance, leads, projects, billing, portal features — all later phases. Build shells, not feature screens.

### ACCEPTANCE
- Login works for FOUNDER, MANAGER, EMPLOYEE, CLIENT; each lands in its correct shell; cross-shell access is refused server-side.
- Isolation tests and permission tests pass.
- Every feature Phase 0 marked PRESERVE still works — list each and how it was verified.
- /design-system matches §7 exactly: obsidian surfaces, restrained gold, correct type, tabular numbers, spacing.
- Global Definition of Done (CLAUDE.md §9) passes.

### DELIVERABLES
Code · migrations · seed · docs/DESIGN_SYSTEM.md · updated ARCHITECTURE / DATA_MODEL / DECISIONS / PHASE_LOG · docs/phases/PHASE_1_REPORT.md.

### GATE — STOP and wait for "Phase 1 approved."

---

## PHASE 2 — TEAM OPERATING SYSTEM: EMPLOYEES · SKILLS · ATTENDANCE · TASKS · EMPLOYEE DASHBOARD · TEAM ANALYTICS

*Issued 2026-09-25, while Phase 1 was still in progress. Recorded here
verbatim; **not started** — its prerequisite is "Phase 1 approved."*

Prerequisite: "Phase 1 approved."

### OBJECTIVE
Make Advertise X the internal operating system for the team — humans and AI employees on one model — with a professional attendance system, task execution with full history, an execution-focused employee dashboard, and founder-level team performance analytics with fully transparent formulas.

### SCOPE
1. Employee model (extends User/Membership): type HUMAN | AI_AGENT, name, avatar, role/title, department, skills (structured taxonomy with proficiency 1–5), responsibilities, weekly capacity (hours), working schedule, status. Employee profile page: info, skills, current projects, assigned and completed tasks, performance, attendance, working hours, activity history.
2. Skills taxonomy: seeded catalog — Google Ads, Meta Ads, Lead Generation, UI/UX, Graphic Design, Creative Production, Development, Websites, Mobile Apps, Automation, SEO, Local SEO, Google Business Profile, Social Media Marketing, Branding, AI Automation, CRM Implementation — extensible by the founder.
3. Attendance: clock in, clock out, breaks; working hours computed; late arrival and early departure against a configurable per-employee schedule; absence; daily and monthly history; monthly attendance report; founder team-wide attendance view with export. Timezone-correct. Unit tests on hours, late, early, and break calculations.
4. Tasks: title, description, project (optional now, attached in Phase 4), assignee, priority, due date, status Not Started → In Progress → Review → Completed, checklist, comments, attachments (via File), full activity history. Overdue detection as a scheduled job.
5. Employee dashboard (Team shell): My Work — assigned projects, assigned tasks, priority tasks, upcoming deadlines, overdue, completed, current workload %. My Performance — tasks completed, projects completed, on-time delivery rate, working hours, attendance. Calm, task-first, zero clutter.
6. Founder Team Performance analytics: attendance, working hours, tasks completed / overdue, projects delivered, on-time delivery rate, assigned workload, productivity — per employee and team-wide. Attendance metrics and performance metrics are computed and displayed SEPARATELY, each with a visible "how this is calculated" definition. An overall score is optional and, if shown, is clearly labeled as a weighted composite with the weights displayed.
7. Activity history: every task, attendance, and profile change appears in the employee's activity feed (sourced from the audit log).
8. In-app notifications: task assigned, task overdue, deadline approaching (via the job).

### ACCEPTANCE
- Full day-in-the-life works: employee logs in → clocks in → sees tasks → moves a task through every status → clocks out; the founder sees all of it reflected in team analytics.
- Every formula documented in docs/METRICS.md and covered by unit tests.
- AI-agent employees appear in the team with a distinct, elegant treatment (badge, no attendance, capability list).
- Global Definition of Done passes.

### GATE — docs/phases/PHASE_2_REPORT.md, then STOP for "Phase 2 approved."

---

## PHASE 3 — LEAD PIPELINE & OUTREACH TRACKING

*Issued 2026-09-26 after Phase 2 was delivered; taken as the founder's
go-ahead (recorded in PHASE_LOG). Verbatim below.*

Prerequisite: "Phase 2 approved."

### OBJECTIVE
A complete, fast CRM lead pipeline with outreach activity tracking, and a one-click conversion of a won lead into a Client + Project with zero re-entry.

### SCOPE
1. Lead model: business name, contact person, email, phone, website, location, industry (restaurant/food segments as defaults), lead source (enum + custom), assigned employee, deal value, stage, notes, tags, lost reason, timestamps.
2. Pipeline stages: New Lead → Contacted → Qualified → Meeting → Proposal → Negotiation → Won / Lost. Kanban board (drag-and-drop, keyboard accessible) plus table view; filters (stage, source, owner, value, dates); saved views; global search.
3. Follow-ups: schedule, due, complete, snooze. "Due today / overdue" surfaced on employee and founder dashboards; reminders via notifications.
4. Communication history per lead: calls, emails, meetings, notes — logged manually now (integration adapters later); timeline UI.
5. Outreach activity tracking: cold calls, emails sent, emails replied, follow-ups, meetings booked, meetings completed, proposals sent, deals closed — logged per employee with daily / weekly / monthly rollups. Founder sees per-employee and company-wide; employees see their own.
6. Founder Leads analytics: total, new, qualified, contacted, follow-ups, meetings booked, converted, lost, by source, conversion rate, pipeline value, stage velocity — real charts per §7.
7. Convert Lead → Client + Project: ONE action creates the ClientAccount (optionally inviting a client user), copies all lead data, creates the first Project with selected services, links the lead history to the client, marks the lead Won. Transactional and audit-logged.
8. CSV import/export for leads with validation and duplicate detection.

### ACCEPTANCE
- Lead lifecycle works end-to-end including conversion; no duplicate data entry anywhere.
- Kanban stays fast with 1,000+ leads (pagination / virtualization).
- Outreach metrics reconcile exactly with logged activities (tests).
- Global Definition of Done passes.

### GATE — docs/phases/PHASE_3_REPORT.md, then STOP for "Phase 3 approved."

---

## PHASE 4 — CLIENT MANAGEMENT & PROJECT MANAGEMENT

*Issued 2026-09-26 after Phase 3 was delivered; taken as the founder's
go-ahead (recorded in PHASE_LOG). Verbatim below.*

Prerequisite: "Phase 3 approved."

### OBJECTIVE
The client profile becomes the single source of truth for everything about a client, and every client has one or many fully managed projects.

### SCOPE
1. Client profile (internal): client and company info; services purchased from a catalog — Website Development, Mobile Application, Google Ads, Meta Ads, SEO, Local SEO, Google Business Profile Optimization, Social Media Marketing, Branding, AI Automation, CRM Implementation — extensible with pricing and recurrence; projects; contracts (files + status + dates); billing summary (wires to Phase 7); reports (wires to Phase 8); assigned team; communication (wires to Phase 6); secure credentials vault (encrypted, masked, audited access); project progress; important notes; a client health indicator.
2. Project model: name, client, services, start date, deadline, status, priority, assigned team members, required skills (derived from services and editable), tasks (Phase 2 tasks now attach to projects), milestones, progress % (computed from milestones and tasks by a documented formula), reports, files, communication thread, activity.
3. Stage templates per service type (e.g., Website: Planning → Design → Development → Testing → Launch), editable; current stage; completed milestones; upcoming work.
4. Views: projects list and board; project detail (overview, tasks, milestones, files, team, activity); founder Projects analytics (active, completed, delayed, upcoming deadlines, progress, assignments, status); delayed-project detection job.
5. Files: upload to client or project; private storage; signed URLs; previews; internal/external visibility flag.
6. Notifications: new project, project update, deadline approaching.

### ACCEPTANCE
- Client → multiple projects → tasks → milestones → progress works and stays consistent.
- Credentials vault: encrypted at rest, never present in the client bundle, access audited, masked by default (tests).
- Progress formula documented in docs/METRICS.md and tested.
- Global Definition of Done passes.

### GATE — docs/phases/PHASE_4_REPORT.md, then STOP for "Phase 4 approved."

---

## PHASE 5 — AI-POWERED PROJECT & TASK ASSIGNMENT

*Issued 2026-09-27 after Phase 4 was delivered (and its bug sweep); taken as
the founder's go-ahead (recorded in PHASE_LOG). Verbatim below.*

Prerequisite: "Phase 4 approved."

### OBJECTIVE
When a project is created, the system analyzes its requirements and recommends — or automatically assigns — the right team members, with a plain-language explanation and a founder override.

### DESIGN — deterministic core, AI where it adds value
1. Requirement analysis: derive required skills from the selected services (catalog mapping) plus optional AI extraction from the project brief (via modules/ai). Output a structured list of required skills with weights.
2. Scoring — for every eligible employee compute:
   score = w1·skillMatch + w2·availability + w3·(1 − workloadRatio) + w4·performanceHistory + w5·deadlineFit
   Hard constraints: must cover the required skills; capacity must not be exceeded. Weights are founder-configurable. Every input comes from real data: skills and proficiency, capacity, current tasks, on-time delivery rate, deadlines.
3. Output: ranked recommendations per required skill / role with a plain-language explanation, e.g. "Best match: covers 3/3 required skills · 40% capacity free · 96% on-time delivery." Modes: RECOMMEND (founder confirms) or AUTO-ASSIGN (configurable). The founder can override any assignment; overrides are audit-logged and fed back as signals.
4. On assignment: employees see the project and its tasks immediately on their dashboard; notifications fire.
5. Rebalancing: when workload or deadlines change, surface a "reassignment suggested" signal — never a silent change.

### ACCEPTANCE
- Creating a project for "Website + Google Ads + SEO" yields sensible, explainable assignments across the right specialists in the seeded team — verified by tests with fixed data.
- Unit tests cover scoring, constraints, weights, and explanation output.
- Scoring formula documented in docs/METRICS.md.
- Global Definition of Done passes.

### GATE — docs/phases/PHASE_5_REPORT.md, then STOP for "Phase 5 approved."

---

## PHASE 6 — CLIENT PORTAL & CLIENT–TEAM COMMUNICATION

*Issued 2026-09-28 after Phase 5 was delivered; taken as the founder's
go-ahead (recorded in PHASE_LOG). Verbatim below.*

Prerequisite: "Phase 5 approved."

### OBJECTIVE
A secure, elegant, jargon-free client experience in which a restaurant sees only its own world — and communicates with the team, and privately with the founders.

### SCOPE
1. Client auth: invite-only accounts; a client user belongs to exactly one ClientAccount; the session is scoped accordingly.
2. Client Overview: current projects, project progress, active services, upcoming deliverables, recent activity — simplified language, reassuring tone.
3. Project progress: stage tracker (e.g., Planning → Design → Development → Testing → Launch), current stage, completed milestones, upcoming work, relevant updates. Internal notes never leak — explicit internal/external visibility flags on updates, files, and comments.
4. Reports library: reports organized by month and type (e.g., "Monthly Report — January"); open and download; unread indicators. (Automated generation is Phase 8 — build the library and a manual upload path now.)
5. Invoices and payments: read-only, own only — wired to Phase 7 data and placeholder-safe now.
6. Messaging: secure threads per client (client ↔ assigned team, permission-based); file sharing; read receipts; notifications. A separate PRIVATE FOUNDER CHANNEL visible only to the client and the founders. The founder has full visibility and control over all client communication; employees see only threads they are permitted to.
7. Client settings: profile, additional client users (role-limited invites), notification preferences.

### ACCEPTANCE
- Isolation proven by tests: a client can never read or write another client's projects, files, reports, invoices, or messages — including via direct IDs and URLs.
- Internal-only content never renders in the portal (tests).
- The portal is fully responsive and reads as premium and simple.
- Global Definition of Done passes.

### GATE — docs/phases/PHASE_6_REPORT.md, then STOP for "Phase 6 approved."

---

## Phase 7 — Invoices, Payments & Financial Overview

*Issued by the founder on 2026-09-28 (verbatim).*

PHASE 7 — INVOICES, PAYMENTS & FINANCIAL OVERVIEW

Prerequisite: "Phase 6 approved."

### OBJECTIVE
A correct, auditable billing system with a complete founder financial overview and strictly client-scoped visibility.

### SCOPE
1. Invoice model: sequential number per organization, client, project, line items (service, quantity, rate, amount), currency, issue and due dates, status Draft → Sent → Paid / Partially Paid / Overdue / Void, notes; branded premium PDF generation; send via email.
2. Payments: record a payment (method, date, amount, reference); partial payments; payment history; overdue detection job with status change and notifications.
3. Founder financial overview: new clients, closed deals, MRR (from recurring services), payments received, pending, outstanding and overdue, revenue by client, revenue by service, revenue trends — real charts; export.
4. Client portal: own invoices, statuses, payment history, PDF download.
5. Money handling: integer minor units (never floats); documented rounding rules; idempotent payment recording; every mutation audited. Tests on totals, partial payments, and overdue transitions.
6. Stripe prepared behind the integrations interface (adapter + webhook skeleton); live charging feature-flagged and optional.

### ACCEPTANCE
- Financial numbers reconcile across invoices, payments, and dashboards (tests).
- A client sees only its own billing (tests).
- MRR and revenue formulas documented in docs/METRICS.md.
- Global Definition of Done passes.

### GATE — docs/phases/PHASE_7_REPORT.md, then STOP for "Phase 7 approved."
