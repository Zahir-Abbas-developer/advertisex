# Runbook

*Operating Advertise X in production: what to watch, what to do when
something breaks, and how to do the routine things safely. First-time setup
is `docs/DEPLOYMENT.md`.*

---

## 1. What to watch

| Signal | Where | Healthy | Act when |
| --- | --- | --- | --- |
| Uptime | Monitor on `GET /api/health` | `200` | **503** = the database is unreachable → §3.1 |
| Health detail | Same endpoint with `Authorization: Bearer $CRON_SECRET`; the founder dashboard's health line | `"status": "ok"` | `degraded`: a job late or failed (§3.2), storage unconfigured (§3.3) |
| Failed jobs | A **"The <job> job failed"** notification to every founder (bell and email) | none | any → §3.2 |
| Server errors | `/admin/errors` (founder), with an unseen-count badge | quiet | a new repeated error → §3.4 |
| Audit trail | `/admin/audit` (founder), `?action=RECORDS` for every data change | — | investigating who changed what |
| AI spend | `/agents` → spend this month, per agent | within budget | an agent near its budget; runs failing |

Anonymous callers of `/api/health` get only the verdicts; error text and job
summaries need the cron secret.

Job lateness windows: `morning`, `evaluate`, `reports` — 26 hours; `digest` —
8 days; `backup` — the Settings value, and only when the app's own backup is on
(`BACKUP_DIR`).

## 2. Scheduled jobs

| Job | Schedule (UTC) | Does |
| --- | --- | --- |
| `follow-ups` ("morning") | 13:00 daily; acts 8–10 a.m. company time | Follow-ups due, task deadlines, delayed projects, rebalancing suggestions, overdue invoices, email retries and digests, Command Center warm-up, monthly reports (days 1–5), the AI-employee queue |
| `evaluate` | 19:00 daily | The parked modules' daily pass (skips itself when they're off) |
| `reports` | 19:30 daily | Weekly/monthly member reports when due |
| `digest` | Mondays 03:00 | The weekly digest |
| `agents` | not scheduled on Hobby (the morning job drains it); every few minutes on Pro | Runs queued AI-employee work |
| `backup` | when `BACKUP_DIR` is set | `pg_dump` to that directory |

**Run one by hand** (every job is idempotent — a rerun never double-sends or
double-charges):

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/<job>
```

A founder can also POST from a signed-in browser session; GET only works with
the bearer secret (so a link can't trigger a job).

## 3. Incidents

### 3.1 The database is unreachable (health 503)

1. Check the provider's status page and console (Neon/Supabase).
2. Connection limits: on a pooled host `DATABASE_URL` must be the pooled
   string; exhausting direct connections shows as timeouts.
3. If the database is gone or corrupt → §5 (restore into a **new** database).

### 3.2 A job failed or is late

1. Read the failure: the founder notification's text, or `/api/health` with
   the bearer secret (`jobs[].summary`).
2. Fix the cause (usually configuration: email keys, storage, a provider
   outage), then run the job by hand (§2). Idempotent — safe to repeat.
3. `morning` shows `NEVER_RUN` on a fresh deploy until its first 8–10 a.m. run.

### 3.3 Uploads fail / health says storage isn't configured

Production refuses to store files without a bucket. Set `S3_BUCKET`,
`S3_REGION`, `S3_ENDPOINT` (R2), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and
redeploy. A 403 from the bucket means the key lacks object read/write/delete
on it. Test without the app: `npm run storagetest` (drivers) or upload a file
on any client.

### 3.4 Errors in `/admin/errors`

Each entry has the route, message and stack. Group by message; a new one
right after a deploy → roll back in Vercel (Deployments → promote the previous
one) while fixing forward. Client-side errors are reported too, by path.

### 3.5 Email isn't arriving

`Notification.emailState` records every attempt (SENT / FAILED / SKIPPED). The
morning job retries FAILED ones; the email call itself retries transient
errors with backoff and an idempotency key, so a retry can't send twice.
Check the sending domain's SPF/DKIM in Resend, and `EMAIL_FROM`.

### 3.6 Someone is locked out

- **Rate-limited sign-in** clears itself (8 tries per account per 10 minutes).
- **Forgot password:** a founder resets it from Team → Accounts → the person → *Reset password*. That signs them out everywhere and forces a change at
  next sign-in.
- **The only founder is locked out:** `DATABASE_URL=… npm run promote --
  someone@…` makes another account a founder (§4).

### 3.7 A session must end now (lost laptop, departure)

Deactivate the person (Team → Accounts → the person → *Deactivate*) — every session ends
on its next request. Resetting their password does the same while keeping the
account.

## 4. Routine tasks

| Task | How |
| --- | --- |
| Add staff | Team → Accounts → *Add member* (founder) |
| Invite a client's people | Clients → the client → *Portal access* → *Invite* (or the client's owner invites their own team) |
| Make someone a founder | `npm run promote -- someone@…` (`--demote`, `--list`); refuses to remove the last active founder; audited |
| Hire / pause an AI employee | AI employees → *Hire an AI employee* / the settings icon on its card |
| Change schedules, grace periods, modules | Settings (founder); takes effect within 5 seconds |
| Rotate `NEXTAUTH_SECRET` | Set a new value and redeploy — everyone signs in again |
| Rotate `CRON_SECRET` | Change it in Vercel; Vercel Cron picks it up; update any external caller |

### Rotate the vault key

1. `openssl rand -base64 32` → the new key.
2. Set `VAULT_KEY_PREVIOUS` = the current key, `VAULT_KEY` = the new one.
   Deploy. Both open; new secrets use the new key.
3. `VAULT_KEY=<new> VAULT_KEY_PREVIOUS=<old> DATABASE_URL=… npm run
   vault:reseal` (dry run), then with `-- --apply`. It opens every secret first
   and writes nothing unless all of them open.
4. When it reports `0 under an older key`, remove `VAULT_KEY_PREVIOUS` and
   deploy. Keep the old key offline for as long as backups sealed with it
   exist.

*Rehearsed on staging, 2026-09-29.*

## 5. Backup and restore

**Primary backup: the database provider.** Neon (point-in-time restore, on by
default) or Supabase (daily; PITR on Pro). Continuous and off-site. With
`BACKUP_DIR` unset the app treats the provider as the backup and the health
check doesn't warn about its own.

**Secondary: the app's nightly `pg_dump`** — only where the host has
`pg_dump` and a persistent disk (not Vercel). Set `BACKUP_DIR`; the `backup`
job writes there and the health check warns after `backupWarnHours`.

**Files** live in the bucket, not the database: turn on the bucket's
versioning or its provider's backup.

### Restore (rehearsed on staging, 2026-09-29)

Never restore over the live database.

```bash
# 1. Stop writes: pause the Vercel deployment (or put up maintenance).

# 2a. Provider snapshot: restore to a NEW branch/database in the console.
# 2b. Or from a dump:
createdb advertisex_restore
pg_restore --no-owner --no-privileges --dbname=advertisex_restore backup.dump

# 3. Check it's the database you think it is — and that it matches the code.
psql advertisex_restore -c 'select count(*) from "Invoice";'
psql advertisex_restore -c 'select max("createdAt") from "AuditLog";'
DATABASE_URL=postgresql://…/advertisex_restore \
  npx prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script
#   → "-- This is an empty migration."  (if not, deploy migrations: npm run db:deploy)

# 4. Point DATABASE_URL (and DATABASE_URL_UNPOOLED) at it; redeploy; resume.

# 5. Run the morning and evaluate jobs once by hand (idempotent) so anything
#    the missing window should have done is done.
```

The rehearsal dumped staging (371 KB), restored it into a new database, and
matched row counts across users, leads, clients, projects, invoices,
payments, reports, the audit log and the vault; the schema check was empty.

## 6. Never show clients a development server

`npm run dev` sends React's DevTools debug data with every page, and that
includes values a page loaded and then refused to show. Demos and client
previews always run a production build (`npm run build && npm start`, which
is what `npm run share` does).

## 7. Performance checks

- **Queries per request:** start a server with `PRISMA_QUERY_LOG=1`, load a
  page, count `prisma:query` lines. Pages settle at 10–50; a count that grows
  with the number of rows on screen is an N+1.
- **Lighthouse:** `npx lighthouse https://<app>/dashboard
  --extra-headers='{"Cookie":"<a session cookie>"}' --preset=desktop`. Launch
  baseline in `docs/phases/PHASE_10_REPORT.md`.
- **Field data:** Vercel Speed Insights for LCP/INP from real phones.
