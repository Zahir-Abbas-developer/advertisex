import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { authorizeCron } from "@/lib/cron-auth";
import { runDueNow } from "@/modules/ai/agents/runner";

/**
 * The agent worker (Phase 9). Runs start in-process the moment they're
 * queued; this drains anything left — runs deferred by a rate limit, runs a
 * serverless host froze mid-flight, runs retried after a stale lease. A
 * scheduler may call it as often as the plan allows; the morning job drains too.
 */
export async function POST(request: Request) {
  const auth = await authorizeCron(request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ status: "ok", ...(await runDueNow()) });
  } catch {
    return apiError("The agent worker failed", 500);
  }
}

export async function GET(request: Request) {
  return POST(request);
}

export const dynamic = "force-dynamic";
