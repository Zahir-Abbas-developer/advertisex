import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import {
  AttendanceError,
  clockIn,
  clockOut,
  endBreak,
  isMonthKey,
  month,
  monthOf,
  startBreak,
  today,
} from "@/modules/attendance/server";

/**
 * The signed-in person's own time clock.
 *
 * GET  — today (status, worked time, breaks) and a month (?month=YYYY-MM,
 *        default this month) with its summary.
 * POST — { action: "clock-in" | "clock-out" | "break-start" | "break-end" }.
 *
 * Always one's own: there is no way to clock someone else in, so the
 * matrix's `own` scope is satisfied by construction.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "attendance");
  if (access.response) return access.response;
  const me = access.principal.id;

  if (access.principal.role === "AI_AGENT") return apiError("Attendance doesn't apply to AI agents", 403);

  const requested = new URL(request.url).searchParams.get("month");
  const now = new Date();
  const day = await today(me, now);
  const key = isMonthKey(requested) ? requested : monthOf(now, day.schedule.timezone);
  const view = await month(me, key, now);

  return NextResponse.json({ today: day, month: view });
}

const actionSchema = z.object({
  action: z.enum(["clock-in", "clock-out", "break-start", "break-end"]),
});

export async function POST(request: Request) {
  const access = await requireApi("create", "attendance");
  if (access.response) return access.response;
  const me = access.principal.id;

  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Unknown time-clock action", 422);

  try {
    const now = new Date();
    if (parsed.data.action === "clock-in") await clockIn(me, now);
    if (parsed.data.action === "clock-out") await clockOut(me, now);
    if (parsed.data.action === "break-start") await startBreak(me, now);
    if (parsed.data.action === "break-end") await endBreak(me, now);
    return NextResponse.json({ today: await today(me, now) });
  } catch (error) {
    if (error instanceof AttendanceError) return apiError(error.message, 409);
    throw error;
  }
}
