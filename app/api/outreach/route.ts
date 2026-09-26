import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { rangeFromQuery } from "@/lib/date";
import { requireApi } from "@/modules/rbac/server";
import { bucketOf, OUTREACH_ACTIVITY_TYPES, rollup, type Period } from "@/modules/outreach/domain";

const DEFAULT_SPAN_DAYS: Record<Period, number> = { day: 30, week: 12 * 7, month: 365 };
const MAX_SPAN_DAYS = 3 * 366;

/**
 * Outreach rollups (Phase 3 scope 5): counts of logged outreach, by day,
 * week or month on the company calendar, per person and overall.
 *
 * Scope: an employee sees only their own; a manager, the people working in
 * their departments; the founder, everyone. Every figure is a count of
 * SalesActivity rows through modules/outreach/domain.ts — nothing stored.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "activity");
  if (access.response) return access.response;
  const principal = access.principal;

  const url = new URL(request.url);
  const period = (["day", "week", "month"] as const).find((p) => p === url.searchParams.get("period")) ?? "week";
  const timeZone = await companyTimezone();
  const range = rangeFromQuery(url.searchParams, DEFAULT_SPAN_DAYS[period], MAX_SPAN_DAYS, timeZone);
  if (!range) return NextResponse.json({ error: "Pick a date range of at most three years" }, { status: 422 });
  const { from, to } = range;

  // Whose outreach this viewer may see.
  const requestedUser = url.searchParams.get("userId");
  const userFilter =
    principal.role === "FOUNDER"
      ? requestedUser ? { userId: requestedUser } : {}
      : principal.role === "MANAGER"
        ? {
            departmentId: { in: [...principal.departmentIds] },
            ...(requestedUser ? { userId: requestedUser } : {}),
          }
        : { userId: principal.id };

  const rows = await prisma.salesActivity.findMany({
    where: { occurredAt: { gte: from, lte: to }, type: { in: OUTREACH_ACTIVITY_TYPES }, ...userFilter },
    select: { type: true, occurredAt: true, userId: true },
  });

  const result = rollup(rows, period, timeZone);
  const people = await prisma.user.findMany({
    where: { id: { in: Object.keys(result.byUser) } },
    select: { id: true, name: true, avatarColor: true, role: true },
  });

  return NextResponse.json({
    from: from.toISOString(),
    to: to.toISOString(),
    spanDays: Math.round((to.getTime() - from.getTime()) / 86_400_000),
    /** The bucket "now" falls in — today, this week or this month. */
    current: bucketOf(new Date(), period, timeZone),
    scope: principal.role === "FOUNDER" ? "company" : principal.role === "MANAGER" ? "departments" : "self",
    ...result,
    people,
    counted: rows.length,
  });
}
