import { NextResponse } from "next/server";

import { healthReport, type HealthReport } from "@/lib/ops";
import { authorizeCron } from "@/lib/cron-auth";

/**
 * Liveness and freshness, in one place.
 *
 * Deliberately **unauthenticated**: an uptime monitor cannot hold a session,
 * and a health endpoint behind auth is one that only tells you the truth when
 * you're already logged in and looking.
 *
 * Anonymous callers get the verdict only — up or down, and which jobs are
 * fresh or stale. Error text and job summaries (which can carry internal
 * detail) are for the scheduler's bearer secret (Phase 10); the dashboard's
 * widget reads the full report on the server. The one thing it deliberately does *not* do
 * is return 500 when the database is fine but a backup is late: that would
 * page someone about a stale snapshot as though the app were down.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const report = await healthReport();
  const detailed = request.headers.has("authorization") ? (await authorizeCron(request)).ok : false;

  return NextResponse.json(detailed ? report : publicView(report), {
    // Degraded is a 200 with a body that says so. Only a dead database is a 503.
    status: report.database.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

/** What anyone may know: the verdicts, without error text or job summaries. */
function publicView(report: HealthReport) {
  return {
    status: report.status,
    checkedAt: report.checkedAt,
    database: { ok: report.database.ok, latencyMs: report.database.latencyMs },
    storage: { configured: report.storage.configured },
    jobs: report.jobs.map((j) => ({ job: j.job, status: j.status, lastRunAt: j.lastRunAt, stale: j.stale })),
    backup: { mode: report.backup.mode, lastAt: report.backup.lastAt, stale: report.backup.stale },
  };
}
