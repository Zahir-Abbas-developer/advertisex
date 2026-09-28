"use client";

import { useCallback, useEffect, useState } from "react";
import { Download } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Tooltip } from "@/components/ui/Tooltip";
import { HowCalculated } from "@/components/team/HowCalculated";
import { DAY_LABEL, percent } from "@/components/attendance/TimeClock";
import { formatMinutes, type DayResult, type MonthSummary } from "@/modules/attendance/domain";
import { cn } from "@/lib/utils";

type Person = {
  id: string;
  name: string;
  avatarColor: string;
  jobTitle: string;
  summary: MonthSummary;
  days: DayResult[];
};

const DOT: Record<string, string> = {
  PRESENT: "bg-success",
  LATE: "bg-warn",
  IN_PROGRESS: "bg-info",
  ABSENT: "bg-danger",
  ON_LEAVE: "bg-ink/40",
  OFF: "bg-ink/10",
  UPCOMING: "bg-ink/10",
};

/**
 * The founder's team attendance: one row per person, their month summary,
 * and a strip of days (hover for the detail). The CSV export is the same
 * data, one line per person per day.
 */
export function TeamAttendance() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [people, setPeople] = useState<Person[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setPeople(null);
    const res = await fetch(`/api/time/team?month=${month}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setPeople((await res.json()).people);
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-44">
          <Input label="Month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <HowCalculated topic="attendance" />
          <a href={`/api/time/team?month=${month}&format=csv`} download className={buttonClasses("secondary", "md", "gap-2")}>
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        </div>
      </div>

      {failed ? (
        <ErrorState title="Attendance didn't load" description="Try again in a moment." onRetry={() => void load()} />
      ) : !people ? (
        <Skeleton className="h-[360px] rounded-card" />
      ) : people.length === 0 ? (
        <Card padded={false}>
          <EmptyState title="Nobody to show" description="Attendance applies to the people on your team — AI agents have none." />
        </Card>
      ) : (
        <TableShell>
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH className="text-right">Attendance</TH>
                <TH className="text-right">Punctuality</TH>
                <TH className="text-right">Worked</TH>
                <TH className="text-right">Absent</TH>
                <TH>Days</TH>
              </TR>
            </THead>
            <TBody>
              {people.map((p) => (
                <TR key={p.id}>
                  <TD>
                    <a href={`/team/${p.id}`} className="flex items-center gap-2.5 hover:text-brand">
                      <Avatar name={p.name} color={p.avatarColor} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">{p.name}</span>
                        <span className="block truncate text-[12px] text-ink-muted">{p.jobTitle}</span>
                      </span>
                    </a>
                  </TD>
                  <TD className="text-right tabular-nums">{percent(p.summary.attendanceRate)}</TD>
                  <TD className="text-right tabular-nums">{percent(p.summary.punctualityRate)}</TD>
                  <TD className="text-right tabular-nums">{formatMinutes(p.summary.workedMinutes)}</TD>
                  <TD className="text-right tabular-nums">
                    {p.summary.absentDays > 0 ? <Badge tone="danger" size="sm">{p.summary.absentDays}</Badge> : "0"}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {p.days.map((d) => (
                        <Tooltip
                          key={d.date}
                          content={`${d.date} · ${DAY_LABEL[d.status]}${d.workedMinutes ? ` · ${formatMinutes(d.workedMinutes)}` : ""}${d.lateMinutes ? ` · ${d.lateMinutes}m late` : ""}`}
                        >
                          <span aria-label={`${d.date} ${DAY_LABEL[d.status]}`} className={cn("block h-3 w-3 rounded-[3px]", DOT[d.status])} />
                        </Tooltip>
                      ))}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}
      <div className="flex flex-wrap gap-3 text-[12px] text-ink-muted">
        {(["PRESENT", "LATE", "ABSENT", "ON_LEAVE", "OFF"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2.5 w-2.5 rounded-[3px]", DOT[s])} /> {DAY_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  );
}
