"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Bot } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { HowCalculated } from "@/components/team/HowCalculated";
import { percent } from "@/components/attendance/TimeClock";
import { formatMinutes, type MonthSummary } from "@/modules/attendance/domain";

type Row = {
  member: { id: string; name: string; avatarColor: string; jobTitle: string; isAgent: boolean };
  performance: {
    openTasks: number;
    tasksCompleted: number;
    tasksOverdue: number;
    onTimeRate: number | null;
    workload: number | null;
    projectsDelivered: number;
  };
  attendance: MonthSummary | null;
};
type Team = {
  people: number;
  agents: number;
  tasksCompleted: number;
  tasksOverdue: number;
  openTasks: number;
  projectsDelivered: number;
  workedMinutes: number;
  scheduledMinutes: number;
  presentDays: number;
  lateDays: number;
  absentDays: number;
  onTimeRate: number | null;
};

function Who({ member }: { member: Row["member"] }) {
  return (
    <Link href={`/team/${member.id}`} className="flex items-center gap-2.5 hover:text-brand">
      {member.isAgent ? (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-data-2/30 bg-data-2/10 text-data-2">
          <Bot className="h-3.5 w-3.5" />
        </span>
      ) : (
        <Avatar name={member.name} color={member.avatarColor} size="sm" />
      )}
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium text-ink">{member.name}</span>
        <span className="block truncate text-[12px] text-ink/45">{member.jobTitle}</span>
      </span>
    </Link>
  );
}

/**
 * Founder-level team performance. Delivery and attendance are computed by
 * separate engines and shown in separate sections, each with its definition.
 * No composite score: combining them would need weights, and the prompt
 * requires any such score to show its weights — so none is invented.
 */
export function TeamPerformance() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<{ rows: Row[]; team: Team } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setData(null);
    const res = await fetch(`/api/team/performance?month=${month}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const picker = (
    <div className="w-44">
      <Input label="Month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
    </div>
  );

  if (failed) return <ErrorState title="Team performance didn't load" description="Try again in a moment." onRetry={() => void load()} />;
  if (!data) {
    return (
      <div className="space-y-6">
        {picker}
        <Skeleton className="h-[140px] rounded-card" />
        <Skeleton className="h-[320px] rounded-card" />
      </div>
    );
  }
  if (data.rows.length === 0) {
    return (
      <div className="space-y-6">
        {picker}
        <Card padded={false}>
          <EmptyState title="No one on your team yet" description="Once people and agents are assigned work, their delivery shows here." />
        </Card>
      </div>
    );
  }

  const { team } = data;
  const humans = data.rows.filter((r) => r.attendance);
  const worked = team.presentDays + team.absentDays;

  return (
    <div className="space-y-10">
      {picker}

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Delivery</h2>
            <p className="text-[13px] text-ink/50">
              {team.people - team.agents} people and {team.agents} AI agent{team.agents === 1 ? "" : "s"}.
            </p>
          </div>
          <HowCalculated topic="performance" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard label="Tasks completed" value={String(team.tasksCompleted)} />
          <StatCard label="On-time delivery" value={percent(team.onTimeRate)} />
          <StatCard label="Overdue now" value={String(team.tasksOverdue)} tone={team.tasksOverdue > 0 ? "danger" : "neutral"} />
          <StatCard label="Open tasks" value={String(team.openTasks)} />
          <StatCard label="Projects delivered" value={String(team.projectsDelivered)} />
        </div>
        <TableShell>
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH className="text-right">Completed</TH>
                <TH className="text-right">On time</TH>
                <TH className="text-right">Overdue</TH>
                <TH className="text-right">Open</TH>
                <TH className="text-right">Workload</TH>
                <TH className="text-right">Projects</TH>
              </TR>
            </THead>
            <TBody>
              {data.rows.map((r) => (
                <TR key={r.member.id}>
                  <TD><Who member={r.member} /></TD>
                  <TD className="text-right tabular-nums">{r.performance.tasksCompleted}</TD>
                  <TD className="text-right tabular-nums">{percent(r.performance.onTimeRate)}</TD>
                  <TD className={r.performance.tasksOverdue > 0 ? "text-right tabular-nums text-danger" : "text-right tabular-nums"}>{r.performance.tasksOverdue}</TD>
                  <TD className="text-right tabular-nums">{r.performance.openTasks}</TD>
                  <TD className={(r.performance.workload ?? 0) > 1 ? "text-right tabular-nums text-warn" : "text-right tabular-nums"}>{percent(r.performance.workload)}</TD>
                  <TD className="text-right tabular-nums">{r.performance.projectsDelivered}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Attendance</h2>
            <p className="text-[13px] text-ink/50">People only — AI agents have no attendance.</p>
          </div>
          <HowCalculated topic="attendance" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Hours worked" value={formatMinutes(team.workedMinutes)} hint={`of ${formatMinutes(team.scheduledMinutes)} scheduled`} />
          <StatCard label="Days worked" value={String(team.presentDays)} hint={worked > 0 ? `${team.absentDays} absence${team.absentDays === 1 ? "" : "s"}` : undefined} />
          <StatCard label="Late arrivals" value={String(team.lateDays)} />
          <StatCard label="Punctuality" value={percent(team.presentDays > 0 ? (team.presentDays - team.lateDays) / team.presentDays : null)} />
        </div>
        <TableShell>
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH className="text-right">Attendance</TH>
                <TH className="text-right">Punctuality</TH>
                <TH className="text-right">Worked</TH>
                <TH className="text-right">Absent</TH>
                <TH className="text-right">Left early</TH>
              </TR>
            </THead>
            <TBody>
              {humans.map((r) => (
                <TR key={r.member.id}>
                  <TD><Who member={r.member} /></TD>
                  <TD className="text-right tabular-nums">{percent(r.attendance!.attendanceRate)}</TD>
                  <TD className="text-right tabular-nums">{percent(r.attendance!.punctualityRate)}</TD>
                  <TD className="text-right tabular-nums">{formatMinutes(r.attendance!.workedMinutes)}</TD>
                  <TD className="text-right tabular-nums">{r.attendance!.absentDays}</TD>
                  <TD className="text-right tabular-nums">{r.attendance!.earlyDepartureDays}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      </section>
    </div>
  );
}
