import { NextResponse } from "next/server";

import { companyTimezone } from "@/lib/company-time";
import { isMonthKey, monthOf } from "@/modules/attendance/server";
import { requireApi } from "@/modules/rbac/server";
import { attendanceFor, directoryFor, monthBounds, performanceFor } from "@/modules/team/server";

/**
 * Team performance for a month: delivery and attendance per person, kept
 * separate (Phase 2 scope 6), plus team-wide totals. Founder: everyone;
 * manager: their departments. Formulas: docs/METRICS.md.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "employee");
  if (access.response) return access.response;
  if (access.principal.role === "EMPLOYEE") {
    return NextResponse.json({ error: "Team performance is for the founder and managers" }, { status: 403 });
  }

  const requested = new URL(request.url).searchParams.get("month");
  const timezone = await companyTimezone();
  const key = isMonthKey(requested) ? requested : monthOf(new Date(), timezone);
  const { from, to } = monthBounds(key, timezone);

  const members = await directoryFor(access.principal);
  const [performance, attendance] = await Promise.all([
    performanceFor(members, from, to),
    attendanceFor(members, key),
  ]);

  const rows = members.map((m) => ({
    member: m,
    performance: performance.get(m.id)!,
    attendance: attendance.get(m.id)?.summary ?? null,
  }));

  const sum = (pick: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + pick(r), 0);
  const humans = rows.filter((r) => r.attendance);
  const judged = sum((r) => r.performance.completedWithDeadline);

  return NextResponse.json({
    month: key,
    rows,
    team: {
      people: rows.length,
      agents: rows.filter((r) => r.member.isAgent).length,
      tasksCompleted: sum((r) => r.performance.tasksCompleted),
      tasksOverdue: sum((r) => r.performance.tasksOverdue),
      openTasks: sum((r) => r.performance.openTasks),
      projectsDelivered: sum((r) => r.performance.projectsDelivered),
      workedMinutes: humans.reduce((t, r) => t + r.attendance!.workedMinutes, 0),
      scheduledMinutes: humans.reduce((t, r) => t + r.attendance!.scheduledMinutes, 0),
      // Team rates are pooled from the people's own counts, never an average
      // of averages — a person with one task must not weigh like one with fifty.
      presentDays: humans.reduce((t, r) => t + r.attendance!.presentDays, 0),
      lateDays: humans.reduce((t, r) => t + r.attendance!.lateDays, 0),
      absentDays: humans.reduce((t, r) => t + r.attendance!.absentDays, 0),
      onTimeRate: judged > 0 ? sum((r) => r.performance.completedOnTime) / judged : null,
    },
  });
}
