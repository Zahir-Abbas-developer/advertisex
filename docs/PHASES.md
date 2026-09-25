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
