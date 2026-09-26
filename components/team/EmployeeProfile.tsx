"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Pencil } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { HowCalculated } from "@/components/team/HowCalculated";
import { Proficiency } from "@/components/team/TeamDirectory";
import { EditProfileModal, type ProfileForm } from "@/components/team/EditProfileModal";
import { ActivityFeed, type FeedEntry } from "@/components/team/ActivityFeed";
import { percent } from "@/components/attendance/TimeClock";
import { ROLE_LABEL, type Role } from "@/config/permissions";
import { formatMinutes, type MonthSummary } from "@/modules/attendance/domain";
import { TASK_STATUS_LABEL, normalizeTaskStatus } from "@/modules/tasks/domain";

type Profile = {
  member: {
    id: string;
    name: string;
    role: Role;
    isAgent: boolean;
    jobTitle: string;
    avatarColor: string;
    employmentStatus: string;
    weeklyCapacityHours: number;
    departments: { id: string; shortLabel: string }[];
  };
  month: string;
  responsibilities: string | null;
  schedule: { timezone: string; workDays: string; startMinute: number; endMinute: number; graceMinutes: number } | null;
  capabilities: { resource: string; action: string }[];
  skills: { proficiency: number; skill: { id: string; name: string; category: string } }[];
  performance: {
    openTasks: number;
    tasksCompleted: number;
    tasksOverdue: number;
    onTimeRate: number | null;
    workload: number | null;
    projectsDelivered: number;
  } | null;
  attendance: { summary: MonthSummary } | null;
  activity: FeedEntry[];
  tasks: {
    id: string;
    title: string;
    status: string;
    priority: string;
    dueAt: string | null;
    completedAt: string | null;
    project: { id: string; title: string; status: string } | null;
  }[];
  canEdit: boolean;
};

const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-display text-lg font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmployeeProfile({ id }: { id: string }) {
  const [data, setData] = useState<Profile | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/employees/${id}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <ErrorState title="This profile didn't load" description="It may be outside your team, or try again in a moment." onRetry={() => void load()} />;
  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[180px] rounded-card" />
        <Skeleton className="h-[140px] rounded-card" />
        <Skeleton className="h-[240px] rounded-card" />
      </div>
    );
  }

  const { member, performance: p } = data;
  const open = data.tasks.filter((t) => normalizeTaskStatus(t.status) !== "COMPLETED");
  const done = data.tasks.filter((t) => normalizeTaskStatus(t.status) === "COMPLETED").slice(0, 8);
  const projects = [...new Map(open.filter((t) => t.project).map((t) => [t.project!.id, t.project!])).values()];

  const form: ProfileForm = {
    jobTitle: member.jobTitle,
    responsibilities: data.responsibilities ?? "",
    weeklyCapacityHours: member.weeklyCapacityHours,
    employmentStatus: member.employmentStatus as ProfileForm["employmentStatus"],
    skills: data.skills.map((s) => ({ skillId: s.skill.id, proficiency: s.proficiency })),
    schedule: member.isAgent
      ? null
      : {
          timezone: data.schedule?.timezone ?? "America/New_York",
          workDays: (data.schedule?.workDays ?? "1,2,3,4,5").split(",").map(Number),
          startMinute: data.schedule?.startMinute ?? 540,
          endMinute: data.schedule?.endMinute ?? 1020,
          graceMinutes: data.schedule?.graceMinutes ?? 5,
        },
  };

  return (
    <div className="space-y-10">
      <Card surface="dark">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            {member.isAgent ? (
              <span className="flex h-14 w-14 items-center justify-center rounded-full border border-data-2/30 bg-data-2/10 text-data-2">
                <Bot className="h-7 w-7" />
              </span>
            ) : (
              <Avatar name={member.name} color={member.avatarColor} size="lg" />
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">{member.name}</h1>
                {member.isAgent ? (
                  <span className="rounded-pill border border-data-2/30 bg-data-2/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-data-2">AI agent</span>
                ) : (
                  <Badge tone={member.employmentStatus === "ACTIVE" ? "success" : member.employmentStatus === "ON_LEAVE" ? "warning" : "neutral"} size="sm">
                    {member.employmentStatus === "ACTIVE" ? "Active" : member.employmentStatus === "ON_LEAVE" ? "On leave" : "Inactive"}
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-ink/60">
                {member.jobTitle}
                {!member.isAgent && ` · ${ROLE_LABEL[member.role]}`}
                {member.departments.length > 0 && ` · ${member.departments.map((d) => d.shortLabel).join(", ")}`}
              </p>
              <p className="mt-2 text-[13px] tabular-nums text-ink/45">
                Capacity {member.weeklyCapacityHours}h/week
                {data.schedule &&
                  ` · ${data.schedule.workDays.split(",").map((d) => DAYS[Number(d)]).join(" ")} ${clock(data.schedule.startMinute)}–${clock(data.schedule.endMinute)} (${data.schedule.timezone.replace("_", " ")})`}
              </p>
            </div>
          </div>
          {data.canEdit && (
            <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(true)}>
              Edit profile
            </Button>
          )}
        </div>
        {data.responsibilities && <p className="mt-5 max-w-3xl text-sm leading-relaxed text-ink/70">{data.responsibilities}</p>}
      </Card>

      <Section title="Skills">
        {data.skills.length === 0 ? (
          <p className="text-sm text-ink/45">No skills recorded yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.skills.map((s) => (
              <div key={s.skill.id} className="flex items-center justify-between rounded-[10px] border border-line bg-surface px-4 py-3">
                <div>
                  <p className="text-[13px] font-medium text-ink">{s.skill.name}</p>
                  <p className="text-[11px] text-ink/40">{s.skill.category}</p>
                </div>
                <Proficiency value={s.proficiency} />
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Performance · ${data.month}`} action={<HowCalculated topic="performance" />}>
        {p && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard label="Completed" value={String(p.tasksCompleted)} hint="tasks this month" />
            <StatCard label="On-time delivery" value={percent(p.onTimeRate)} />
            <StatCard label="Overdue" value={String(p.tasksOverdue)} tone={p.tasksOverdue > 0 ? "danger" : "neutral"} />
            <StatCard label="Workload" value={percent(p.workload)} hint={`${p.openTasks} open task${p.openTasks === 1 ? "" : "s"}`} />
            <StatCard label="Projects delivered" value={String(p.projectsDelivered)} />
          </div>
        )}
      </Section>

      {member.isAgent ? (
        <Section title="Capabilities">
          <p className="text-[13px] text-ink/50">An agent may do exactly these things and nothing else. Attendance does not apply to agents.</p>
          {data.capabilities.length === 0 ? (
            <p className="text-sm text-ink/45">No capabilities granted — this agent can&rsquo;t act yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.capabilities.map((c) => (
                <span key={`${c.resource}:${c.action}`} className="rounded-pill border border-data-2/30 bg-data-2/10 px-3 py-1 text-[12px] text-data-2">
                  {c.action} {c.resource}s
                </span>
              ))}
            </div>
          )}
        </Section>
      ) : (
        data.attendance && (
          <Section title={`Attendance · ${data.month}`} action={<HowCalculated topic="attendance" />}>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Attendance" value={percent(data.attendance.summary.attendanceRate)} hint={`${data.attendance.summary.presentDays} of ${data.attendance.summary.scheduledDays} scheduled days`} />
              <StatCard label="Punctuality" value={percent(data.attendance.summary.punctualityRate)} hint={`${data.attendance.summary.lateDays} late`} />
              <StatCard label="Hours worked" value={formatMinutes(data.attendance.summary.workedMinutes)} hint={`of ${formatMinutes(data.attendance.summary.scheduledMinutes)} scheduled`} />
              <StatCard label="Absences" value={String(data.attendance.summary.absentDays)} />
            </div>
          </Section>
        )
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Current work">
          {projects.length > 0 && (
            <p className="text-[13px] text-ink/55">Projects: {projects.map((pr) => pr.title).join(", ")}</p>
          )}
          {open.length === 0 ? (
            <Card padded={false}>
              <EmptyState title="Nothing open" description="Tasks assigned to them will show up here." />
            </Card>
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line bg-surface">
              {open.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 truncate text-[13px] text-ink">{t.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {t.dueAt && <span className="text-[12px] tabular-nums text-ink/45">{t.dueAt.slice(0, 10)}</span>}
                    <Badge size="sm" tone={normalizeTaskStatus(t.status) === "REVIEW" ? "info" : "neutral"}>
                      {TASK_STATUS_LABEL[normalizeTaskStatus(t.status)]}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {done.length > 0 && (
            <>
              <p className="pt-2 text-[12px] uppercase tracking-wider text-ink/40">Recently completed</p>
              <ul className="space-y-1.5">
                {done.map((t) => (
                  <li key={t.id} className="flex justify-between gap-3 text-[13px] text-ink/55">
                    <span className="truncate line-through decoration-ink/25">{t.title}</span>
                    <span className="shrink-0 tabular-nums">{t.completedAt?.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <Section title="Activity">
          <ActivityFeed entries={data.activity} />
        </Section>
      </div>

      {editing && (
        <EditProfileModal
          id={member.id}
          initial={form}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}
    </div>
  );
}
