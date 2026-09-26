import { NextResponse } from "next/server";

import { companyTimezone } from "@/lib/company-time";
import { formatMinutes } from "@/modules/attendance/domain";
import { isMonthKey, monthOf } from "@/modules/attendance/server";
import { requireApi } from "@/modules/rbac/server";
import { attendanceFor, directoryFor } from "@/modules/team/server";

/**
 * The team's attendance for a month — every person attendance applies to
 * (AI agents never), in the caller's directory scope. `?format=csv` returns
 * the same rows as a download: one line per person per day.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "attendance");
  if (access.response) return access.response;
  if (access.principal.role !== "FOUNDER" && access.principal.role !== "MANAGER") {
    return NextResponse.json({ error: "You don't have access to that" }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const requested = params.get("month");
  const key = isMonthKey(requested) ? requested : monthOf(new Date(), await companyTimezone());

  const members = await directoryFor(access.principal);
  const views = await attendanceFor(members, key);
  const people = members.filter((m) => !m.isAgent);

  if (params.get("format") === "csv") {
    const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const lines = [
      ["Name", "Email", "Date", "Status", "Worked", "Worked minutes", "Break minutes", "Late minutes", "Early departure minutes"]
        .map(quote)
        .join(","),
    ];
    for (const person of people) {
      for (const day of views.get(person.id)?.days ?? []) {
        lines.push(
          [
            person.name,
            person.email,
            day.date,
            day.status,
            formatMinutes(day.workedMinutes),
            day.workedMinutes,
            day.breakMinutes,
            day.lateMinutes,
            day.earlyDepartureMinutes,
          ]
            .map(quote)
            .join(","),
        );
      }
    }
    return new NextResponse(lines.join("\n") + "\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendance-${key}.csv"`,
      },
    });
  }

  return NextResponse.json({
    month: key,
    people: people.map((person) => {
      const view = views.get(person.id)!;
      return {
        id: person.id,
        name: person.name,
        avatarColor: person.avatarColor,
        jobTitle: person.jobTitle,
        schedule: view.schedule,
        summary: view.summary,
        days: view.days,
      };
    }),
  });
}
