"use client";

import { useCallback, useEffect, useState } from "react";
import { Coffee, LogIn, LogOut, Play } from "lucide-react";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { HowCalculated } from "@/components/team/HowCalculated";
import { formatMinutes, type DayResult, type DayStatus, type MonthSummary, type Schedule } from "@/modules/attendance/domain";

type Today = {
  date: string;
  schedule: Schedule;
  result: DayResult;
  clockInAt: string | null;
  clockOutAt: string | null;
  onBreak: boolean;
  breaks: { startedAt: string; endedAt: string | null }[];
};
type Month = { month: string; days: DayResult[]; summary: MonthSummary };

export const DAY_TONE: Record<DayStatus, BadgeTone> = {
  PRESENT: "success",
  LATE: "warning",
  IN_PROGRESS: "info",
  ABSENT: "danger",
  ON_LEAVE: "neutral",
  OFF: "neutral",
  UPCOMING: "neutral",
};
export const DAY_LABEL: Record<DayStatus, string> = {
  PRESENT: "Present",
  LATE: "Late",
  IN_PROGRESS: "Working",
  ABSENT: "Absent",
  ON_LEAVE: "On leave",
  OFF: "Day off",
  UPCOMING: "Not started",
};

const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

function time(iso: string | null, timezone: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

/**
 * The employee's own time clock: one span a day, breaks inside it, and the
 * month measured against their schedule. Worked time ticks while clocked in
 * so the number on screen is never stale.
 */
export function TimeClock() {
  const toast = useToast();
  const [today, setToday] = useState<Today | null>(null);
  const [month, setMonth] = useState<Month | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch("/api/time", { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    const body = await res.json();
    setToday(body.today);
    setMonth(body.month);
    setFailed(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (today?.result.status !== "IN_PROGRESS") return;
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, [today?.result.status]);

  async function act(action: "clock-in" | "clock-out" | "break-start" | "break-end") {
    setBusy(true);
    try {
      const res = await fetch("/api/time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(body.error ?? "That didn't go through.");
      toast.success(
        { "clock-in": "Clocked in.", "clock-out": "Clocked out. Good work today.", "break-start": "Enjoy your break.", "break-end": "Welcome back." }[action],
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (failed) return <ErrorState title="Attendance didn't load" description="Try again in a moment." onRetry={() => void load()} />;
  if (!today || !month) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[200px] rounded-card" />
        <Skeleton className="h-[320px] rounded-card" />
      </div>
    );
  }

  const tz = today.schedule.timezone;
  // Live worked minutes while the day is running; the server's figure otherwise.
  const openBreak = today.breaks.find((b) => !b.endedAt);
  const liveWorked =
    today.clockInAt && !today.clockOutAt
      ? Math.max(
          0,
          Math.round(
            ((openBreak ? new Date(openBreak.startedAt).getTime() : Date.now()) - new Date(today.clockInAt).getTime()) / 60_000,
          ) - today.breaks.filter((b) => b.endedAt).reduce((t, b) => t + Math.round((new Date(b.endedAt!).getTime() - new Date(b.startedAt).getTime()) / 60_000), 0),
        )
      : today.result.workedMinutes;

  const s = month.summary;

  return (
    <div className="space-y-8">
      <Card surface="dark">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="eyebrow text-brand">Today · {today.date}</p>
            <p className="mt-3 font-display text-[40px] font-bold leading-none tabular-nums text-ink">
              {formatMinutes(liveWorked)}
            </p>
            <p className="mt-2 text-[13px] text-ink/55">
              Scheduled {today.schedule.workDays.map((d) => DAYS[d]).join(" ")} · {clock(today.schedule.startMinute)}–
              {clock(today.schedule.endMinute)} · {tz.replace("_", " ")}
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge tone={today.onBreak ? "warning" : DAY_TONE[today.result.status]}>
                {today.onBreak ? "On a break" : DAY_LABEL[today.result.status]}
              </Badge>
              {today.result.lateMinutes > 0 && <Badge tone="warning">{today.result.lateMinutes} min late</Badge>}
              <span className="text-[13px] tabular-nums text-ink/55">
                In {time(today.clockInAt, tz)} · Out {time(today.clockOutAt, tz)} · Breaks {today.result.breakMinutes} min
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {!today.clockInAt && (
              <Button loading={busy} icon={<LogIn className="h-4 w-4" />} onClick={() => void act("clock-in")}>
                Clock in
              </Button>
            )}
            {today.clockInAt && !today.clockOutAt && (
              <>
                {today.onBreak ? (
                  <Button variant="secondary" loading={busy} icon={<Play className="h-4 w-4" />} onClick={() => void act("break-end")}>
                    End break
                  </Button>
                ) : (
                  <Button variant="secondary" loading={busy} icon={<Coffee className="h-4 w-4" />} onClick={() => void act("break-start")}>
                    Take a break
                  </Button>
                )}
                <Button loading={busy} icon={<LogOut className="h-4 w-4" />} onClick={() => void act("clock-out")}>
                  Clock out
                </Button>
              </>
            )}
            {today.clockOutAt && <p className="text-[13px] text-ink/55">Done for today.</p>}
          </div>
        </div>
      </Card>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">This month</h2>
          <HowCalculated topic="attendance" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Attendance" value={percent(s.attendanceRate)} hint={`${s.presentDays} of ${s.scheduledDays} scheduled days so far`} />
          <StatCard label="Punctuality" value={percent(s.punctualityRate)} hint={`${s.lateDays} late arrival${s.lateDays === 1 ? "" : "s"}`} />
          <StatCard label="Hours worked" value={formatMinutes(s.workedMinutes)} hint={`of ${formatMinutes(s.scheduledMinutes)} scheduled`} />
          <StatCard label="Absences" value={String(s.absentDays)} hint={`${s.earlyDepartureDays} early departure${s.earlyDepartureDays === 1 ? "" : "s"}`} />
        </div>

        {month.days.length === 0 ? (
          <Card padded={false}>
            <EmptyState title="Nothing recorded yet this month" description="Clock in above and your days will build up here." />
          </Card>
        ) : (
          <TableShell>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Worked</TH>
                  <TH className="text-right">Breaks</TH>
                  <TH className="text-right">Late</TH>
                  <TH className="text-right">Left early</TH>
                </TR>
              </THead>
              <TBody>
                {[...month.days].reverse().map((d) => (
                  <TR key={d.date}>
                    <TD className="tabular-nums text-ink/80">{d.date}</TD>
                    <TD>
                      <Badge tone={DAY_TONE[d.status]} size="sm">{DAY_LABEL[d.status]}</Badge>
                    </TD>
                    <TD className="text-right tabular-nums">{d.workedMinutes ? formatMinutes(d.workedMinutes) : "—"}</TD>
                    <TD className="text-right tabular-nums text-ink/60">{d.breakMinutes ? `${d.breakMinutes}m` : "—"}</TD>
                    <TD className="text-right tabular-nums text-ink/60">{d.lateMinutes ? `${d.lateMinutes}m` : "—"}</TD>
                    <TD className="text-right tabular-nums text-ink/60">{d.earlyDepartureMinutes ? `${d.earlyDepartureMinutes}m` : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
        )}
      </section>
    </div>
  );
}
