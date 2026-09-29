import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { authorizeCron } from "@/lib/cron-auth";
import { sendWeeklyDigests } from "@/lib/email/dispatch";
import { beginJob } from "@/lib/ops";

/**
 * The Monday digest: each member's score and what they owe this week.
 *
 * Separate from /api/cron/evaluate on purpose — a mail run that stalls should
 * not hold up scoring, and the two have different cadences.
 */
export async function POST(request: Request) {
  const auth = await authorizeCron(request);
  if (!auth.ok) return auth.response;

  const finish = await beginJob("digest");
  try {
    const result = await sendWeeklyDigests();
    await finish("OK", JSON.stringify(result).slice(0, 200));
    return NextResponse.json(result);
  } catch (error) {
    await finish("FAILED", error instanceof Error ? error.message : "The digest run failed");
    return apiError("The digest run failed", 500);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
