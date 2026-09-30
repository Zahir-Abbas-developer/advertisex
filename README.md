# Advertise X

AI marketing for restaurants — and the operating system that runs the agency
behind it. One codebase, one data model, three experiences:

| Experience | Who | What |
| --- | --- | --- |
| **Command center** | Founder, managers | Leads and pipeline, clients and projects, finance and invoices, analytics, the team, AI employees, approvals and automations |
| **Team OS** | Employees (human and AI) | Today's tasks, the pipeline, projects, attendance, performance |
| **Client portal** | Each restaurant | Its own projects, reports, invoices, files and a conversation with the team — nothing internal |

The founder's brief and every phase prompt are in `docs/PHASES.md`; how it is built is
in `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md` and `docs/DECISIONS.md`; every
number's formula is in `docs/METRICS.md`. Running it in production is
`docs/DEPLOYMENT.md` (the launch checklist) and `docs/RUNBOOK.md` (day-to-day
operations, incidents, backup and restore).

---

## Requirements

- **Node 20.9+** (developed on 24; CI runs 22) and npm
- **Postgres** in production (Neon or Supabase). SQLite locally.
- **S3-compatible storage** in production (Cloudflare R2, AWS S3, Supabase
  Storage). A local folder in development.

## Local setup

```bash
npm install
cp .env.example .env
# Required: NEXTAUTH_SECRET — openssl rand -base64 32
# Leave DATABASE_URL as file:./dev.db (SQLite)

npm run db:push     # create the local database from the schema
npm run db:seed     # structure + a demo tenant: staff, AI employees, three restaurants
npm run dev         # http://localhost:3000
```

Demo accounts share the password in `SEED_PASSWORD` (default
`advertisex-change-me`) and must change it at first sign-in:

| Account | Role |
| --- | --- |
| `coachd@bwm.local` | Founder |
| `rajazain@bwm.local` | Manager |
| `cam@bwm.local`, `maya@advertisex.example`, … | Employees |
| `marco@osterianonna.example`, `jenny@baosociety.example`, `sam@grindcoffee.example` | Restaurant clients (portal) |

`npm run set-passwords` issues a distinct password per account instead.

## Environment

`.env.example` documents every variable with its purpose. In short:

| Group | Variables | |
| --- | --- | --- |
| Database | `DATABASE_URL` (+ `DATABASE_URL_UNPOOLED` for migrations on a pooled host) | required |
| Auth | `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (the exact public origin) | required |
| Vault | `VAULT_KEY` (32 bytes, base64), `VAULT_KEY_PREVIOUS` when rotating | required in production |
| Jobs | `CRON_SECRET` | required in production |
| Files | `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — or `STORAGE_DRIVER=local` + `UPLOAD_DIR` on a server with a persistent disk | required in production |
| Email | `EMAIL_FROM` + `RESEND_API_KEY` (or `SMTP_*`) | optional — without it email is skipped and in-app notifications still work |
| AI | `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_PRICE_*` | optional — every AI feature has a rules-based path |
| Payments | `STRIPE_*` with `STRIPE_ENABLED=true` | optional, off by default |
| Push / WhatsApp / integrations | `VAPID_*`, `WHATSAPP_*`, `INTEGRATIONS_LIVE`, provider app keys | optional |
| Development only | `AI_PROVIDER=fake`, `AGENT_FETCH_ALLOW_PRIVATE`, `AGENT_WORKER=off`, `PRISMA_QUERY_LOG=1` | refused or meaningless in production |

## Scripts

| Command | |
| --- | --- |
| `npm run dev` · `npm run build` · `npm start` | Develop · build · serve the production build |
| `npm run typecheck` · `npm run lint` · `npm test` | Static checks and the unit suite (~990 tests) |
| `npm run db:push` · `db:seed` · `db:reset` | Local database: sync, seed, wipe-and-reseed |
| `npm run db:deploy` | Apply migrations (production; also run by `vercel-build`) |
| `npm run db:seed:admin` | Create the production owner (once) |
| `npm run promote -- <email>` | Make someone an owner (or `--demote`, `--list`) |
| `npm run bundlescan` | After a build: no secret-handling code in the browser bundle |
| `npm run storagetest` | File storage drivers, with no server running |

**HTTP acceptance suites** run against a server (`SMOKE_BASE=http://localhost:3000`):
`smoke`, `smoke:empty`, `permtest`, `leaks`, `fieldtest`, `journeytest`,
`shelltest`, `tenanttest`, `daytest`, `leadtest`, `outreachtest`, `projecttest`,
`assigntest`, `portaltest`, `billingtest`, `analyticstest`, `reporttest`,
`notifytest`, `agenttest`, `securitytest`, `cycletest` (the founder's whole
business cycle). `CLAUDE.md` §11 says what each proves; CI
(`.github/workflows/ci.yml`) runs them all.

## How the database provider is chosen

Prisma won't read the provider from an environment variable, so
`scripts/sync-db-provider.mjs` rewrites `prisma/schema.prisma` from
`DATABASE_URL` before every dev, build, push, migrate and seed: `file:` →
SQLite, `postgresql://` → Postgres. Migrations (`prisma/migrations/`) are
generated for Postgres, the deployment target; locally, SQLite uses
`db:push`. The full chain was applied to an empty Postgres on the Phase 10
staging run with no drift.

## Security in one paragraph

Every route checks permissions on the server against one matrix
(`config/permissions.ts`), and a data-layer extension scopes every query to
the caller's organization and audits every change. Sessions are re-checked
against the account on every request. Pages carry a nonce-based CSP, frame
denial and the usual hardening headers; uploads are type- and
content-checked; secrets live in an AES-256-GCM vault; login, password
changes, uploads, messages, invitations and search are rate-limited. Details
and the Phase 10 audit: `docs/phases/PHASE_10_REPORT.md`.

## License

Private and unlicensed. Internal software.
