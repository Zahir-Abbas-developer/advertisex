# Deployment & Launch Checklist

*For whoever puts Advertise X into production. Each step names the setting,
why it matters, and how to confirm it. The "Staging" column records the
Phase 10 dress rehearsal (2026-09-29): a production build under `next start`
against a fresh Postgres 18, migrated and seeded exactly as `vercel-build`
does it.*

Target platform: **Vercel** (app and scheduled jobs) + **Neon or Supabase**
(Postgres) + **Cloudflare R2 or AWS S3** (files) + **Resend** (email). Anything
equivalent works; the notes say what to keep in mind.

---

## 1. Hosting (Vercel)

| # | Step | Confirm | Staging |
| --- | --- | --- | --- |
| 1.1 | Import the repository; framework Next.js; **Build Command** `npm run vercel-build` (migrates, seeds structure, builds). Node 20 or later. | The deployment log lists "Applying migration" lines, then the Next build | ✅ `vercel-build`, 14 migrations applied, build clean |
| 1.2 | Set `NEXTAUTH_URL` to the exact public origin (`https://app.example.com`) | Sign-in redirects stay on the domain | ✅ (http://localhost:3100) |
| 1.3 | Custom domain with HTTPS. HSTS is sent automatically on HTTPS responses — only turn on HSTS *preload* once the domain and all subdomains are HTTPS-only for good. | `curl -sI https://…/login` shows `strict-transport-security` and a `content-security-policy` with a nonce | ✅ CSP and headers verified (HSTS only over HTTPS, by design) |
| 1.4 | Plan: Hobby allows daily crons only. Pro allows the agent worker (`/api/cron/agents`) every few minutes — recommended once AI employees are in daily use. | — | n/a |

## 2. Database (Neon or Supabase Postgres)

| # | Step | Confirm | Staging |
| --- | --- | --- | --- |
| 2.1 | Create the database; enable **point-in-time restore** (Neon: on by default; Supabase: PITR on Pro). | Provider console shows backups on | n/a (local cluster) |
| 2.2 | `DATABASE_URL` = the **pooled** connection string; `DATABASE_URL_UNPOOLED` = the direct one (migrations need it). Neon/Supabase want `sslmode=require`; Supabase's pooler wants `pgbouncer=true`. | `vercel-build` migrates without "prepared statement" errors | ✅ |
| 2.3 | First deploy migrates from zero. | `npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma` prints *an empty migration* | ✅ empty — no drift |
| 2.4 | Create the owner once: `ADMIN_EMAIL=… ADMIN_PASSWORD=<16+ chars> ADMIN_NAME=… npm run db:seed:admin`. Never run `db:seed` / `db:seed:demo` against production. | Sign in as the owner; you're forced to keep a strong password | ✅ (demo seed used on staging only) |
| 2.4a | **No known passwords on a live database.** The structure seed creates the team's accounts on every deploy. On a deployment (and without `SEED_PASSWORD`) they're created *locked*, with a random password nobody holds. Hand out access deliberately: `DATABASE_URL=… npm run set-passwords`, or a founder's reset. Never deploy with `SEED_PASSWORD` set to the demo value. | Signing in with `advertisex-change-me` fails | ✅ first production deploy: the six seeded accounts were rotated to private one-time passwords |
| 2.5 | Add a second owner: `npm run promote -- someone@… ` — the day the only owner is locked out is the day you need one. | `npm run promote -- --list` shows two | — |

## 3. Scheduled jobs

| # | Step | Confirm | Staging |
| --- | --- | --- | --- |
| 3.1 | `CRON_SECRET` = `openssl rand -hex 32`. Vercel sends it as `Authorization: Bearer …` to the paths in `vercel.json`. | Jobs return 200 in the Vercel cron log | ✅ secret set |
| 3.2 | Schedules (UTC): `follow-ups` 13:00 daily (the morning run: follow-ups, deadlines, overdue invoices, notifications, digests, reports in the first days of a month, the agent queue); `evaluate` 19:00 daily; `reports` 19:30 daily; `digest` 03:00 Mondays. | — | — |
| 3.3 | Run each once after the first deploy: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/<job>` for `evaluate`, `reports`, `digest`, `agents` (the morning job only acts 8–10 a.m. company time). | `GET /api/health` → every job `OK` except `morning` until its first morning | ✅ all ran; health shows them OK |
| 3.4 | Point an uptime monitor (Better Stack, UptimeRobot) at `GET /api/health`: alert on **503** (database down); warn on `"status": "degraded"` (a job late, storage unconfigured). | The monitor shows green | — |

## 4. File storage

| # | Step | Confirm | Staging |
| --- | --- | --- | --- |
| 4.1 | Create a **private** bucket (R2 or S3). No public access, no website hosting. | Bucket policy denies anonymous reads | — |
| 4.2 | An access key limited to that bucket (read, write, delete objects). Set `S3_BUCKET`, `S3_REGION` (`auto` for R2), `S3_ENDPOINT` (R2: `https://<account>.r2.cloudflarestorage.com`; omit for AWS), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. | `/api/health` → `"storage": { "configured": true }`; upload a file on a client and download it | ✅ driver proven by `npm run storagetest` (SigV4, round-trip); staging ran the local driver on a persistent disk |
| 4.3 | Turn on the bucket's versioning or lifecycle backup if the provider offers it — files are not in the database backup. | — | — |

Without storage configured, production refuses uploads (clear error, health
"degraded") rather than writing to a serverless disk that disappears.

## 5. Email

| # | Step | Confirm | Staging |
| --- | --- | --- | --- |
| 5.1 | Resend: verify the sending domain (SPF, DKIM, DMARC). Set `RESEND_API_KEY` and `EMAIL_FROM` (`Advertise X <team@yourdomain>`). SMTP (`SMTP_*`) works instead. | Send an invitation to yourself; it arrives, not in spam | — (not configured on staging: in-app notifications only, as designed) |
| 5.2 | Without email the app still works: notifications are in-app, and invitation links can be copied from the screen. | — | ✅ |

## 6. Secrets and environment

| # | Variable | Notes | Staging |
| --- | --- | --- | --- |
| 6.1 | `NEXTAUTH_SECRET` | `openssl rand -base64 32`. Rotating it signs everyone out. | ✅ |
| 6.2 | `VAULT_KEY` | `openssl rand -base64 32`. **Store a copy offline** — without it the credentials vault can't be opened. Rotate with `VAULT_KEY_PREVIOUS` (docs/RUNBOOK.md). | ✅ (the first run without it failed the vault check — exactly what this row prevents) |
| 6.3 | `CRON_SECRET` | See 3.1 | ✅ |
| 6.4 | `S3_*` | See 4.2 | ✅ (local driver) |
| 6.5 | `EMAIL_FROM`, `RESEND_API_KEY` | See 5.1 | — |
| 6.6 | `ANTHROPIC_API_KEY` (optional) | AI-written summaries, rationales and drafts; everything works without | — |
| 6.7 | `STRIPE_*` (optional) | Leave `STRIPE_ENABLED` unset until card payments are wanted | — |
| 6.8 | Never set in production | `AI_PROVIDER=fake`, `AGENT_FETCH_ALLOW_PRIVATE`, `AGENT_WORKER=off`, `PRISMA_QUERY_LOG` | ✅ none set |

All variables and their meaning: `.env.example`.

## 7. Launch checks — run on the deployment

| # | Check | How | Staging |
| --- | --- | --- | --- |
| 7.1 | Health | `GET /api/health` → `200`, database ok, storage configured | ✅ |
| 7.2 | Headers | `curl -sI https://…/login`: CSP with a nonce, `x-frame-options: DENY`, `x-content-type-options: nosniff`, HSTS | ✅ |
| 7.3 | The three experiences | Sign in as the owner, an employee and a client; open every screen in the rail at phone and desktop width | ✅ 22 screens, three roles, no console errors or CSP violations |
| 7.4 | The acceptance suites against the deployment (a staging copy, never production data): `SMOKE_BASE=https://… npm run shelltest tenanttest portaltest journeytest billingtest reporttest securitytest cycletest projecttest leadtest` | All green | ✅ 10 suites, 576 checks |
| 7.5 | Lighthouse on the core screens (performance, accessibility, best practices ≥ 90) | `npx lighthouse https://…/dashboard` with a signed-in cookie | ✅ desktop 99–100 · mobile 91–100 |
| 7.6 | A full business cycle by hand: add a lead → convert → deliver the project → approve the month's report → invoice → record the payment; the client sees each step | `npm run cycletest` does the same over HTTP | ✅ 21/21 |
| 7.7 | Restore rehearsal | docs/RUNBOOK.md → "Backup and restore" | — (do once on the provider before launch) |

## 8. After launch

- Watch `/admin/errors` and the dashboard's health line for the first week.
- `npm run roles:backfill -- --apply` once no older deployment is serving
  (ADR-008), then retire the legacy role names.
- Turn on real-user monitoring (Vercel Speed Insights) to confirm field LCP
  on phones (lab: 2.7–3.1 s under simulated slow 4G; target 2.5 s).
