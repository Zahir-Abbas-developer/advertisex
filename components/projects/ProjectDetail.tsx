"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, Info, Trash2 } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { FilesPanel } from "@/components/files/FilesPanel";
import { CredentialsPanel } from "@/components/clients/CredentialsPanel";
import { ProjectPlan } from "@/components/projects/ProjectPlan";
import { ProjectTasks } from "@/components/projects/ProjectTasks";
import { ProjectUpdates } from "@/components/projects/ProjectUpdates";
import { ProjectTeam } from "@/components/projects/ProjectTeam";
import { ProjectDiscussion } from "@/components/projects/ProjectDiscussion";
import { PriorityBadge, progressTone, ProjectStatusBadge, ScheduleBadge } from "@/components/projects/shared/badges";
import type { ProjectPayload, ProjectViewer } from "@/components/projects/types";
import { formatDate } from "@/lib/date";
import { PROJECT_PRIORITIES, PROJECT_PRIORITY_LABEL, PROJECT_STATUS_LABEL, PROJECT_STATUSES, SCHEDULE_LABEL } from "@/modules/projects/domain";
import { safeFetch } from "@/lib/safe-fetch";

type Tab = "overview" | "plan" | "tasks" | "updates" | "files" | "team" | "discussion" | "logins";

const BASIS: Record<string, string> = {
  work: "Each milestone counts by its size (1–5), each task counts 1; the share done, rounded down.",
  stages: "No milestones or tasks yet, so this is the share of stages done.",
  completed: "The project is completed.",
  none: "Nothing is planned yet.",
};

/**
 * One project (Phase 4 scope 4): overview, plan (stages and milestones),
 * tasks, files, team and activity. Anyone on the project moves its work
 * forward; the founder and managers change its shape.
 */
export function ProjectDetail({ projectId, viewerId }: { projectId: string; viewerId: string }) {
  const toast = useToast();
  const router = useRouter();
  const [project, setProject] = useState<ProjectPayload | null>(null);
  const [viewer, setViewer] = useState<ProjectViewer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "error">("loading");
  // Notifications link to ?tab=team when a team plan or suggestion is waiting.
  const initialTab = useSearchParams().get("tab");
  const [tab, setTab] = useState<Tab>(initialTab === "team" || initialTab === "plan" || initialTab === "tasks" || initialTab === "updates" ? (initialTab as Tab) : "overview");

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (res.status === 404) return setStatus("missing");
    if (!res.ok) return setStatus("error");
    const body = await res.json();
    setProject(body.project);
    setViewer(body.viewer);
    setStatus("ready");
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (data: Record<string, unknown>, done: string): Promise<boolean> => {
    const res = await safeFetch(`/api/projects/${projectId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(Object.values((body.fields ?? {}) as Record<string, string>)[0] ?? body.error ?? "That change didn't save");
      return false;
    }
    toast.success(done);
    void load();
    return true;
  };

  const remove = async () => {
    if (!project || !window.confirm(`Delete "${project.title}"? Its plan, milestones, discussion and files go with it. Tasks are kept, unlinked.`)) return;
    const res = await safeFetch(`/api/projects/${projectId}`, { method: "DELETE" });
    if (!res.ok) return toast.error("Couldn't delete the project");
    toast.success("Project deleted");
    router.push("/projects");
  };

  if (status === "loading") {
    return (
      <div className="min-w-0 space-y-6">
        <Skeleton className="h-24 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }
  if (status === "missing") return <EmptyState title="Project not found" description="It may have been deleted, or it isn't one of yours." action={<Link href="/projects" className="text-[13px] text-brand hover:underline">All projects</Link>} />;
  if (status === "error" || !project || !viewer) return <ErrorState title="The project didn't load" onRetry={() => void load()} />;

  const s = project.summary;
  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "overview", label: "Overview" },
    { key: "plan", label: "Plan", count: s.openMilestones || undefined },
    { key: "tasks", label: "Tasks", count: s.openTasks || undefined },
    { key: "updates", label: "Updates" },
    { key: "files", label: "Files" },
    { key: "team", label: "Team" },
    { key: "discussion", label: "Discussion & activity" },
    ...(viewer.canSeeCredentials ? [{ key: "logins" as const, label: "Client logins" }] : []),
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={viewer.canSeeClient ? "Project" : project.client.businessName}
        title={project.title}
        description={project.description ?? undefined}
        actions={
          viewer.canDelete ? (
            <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => void remove()}>
              Delete
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {viewer.canSeeClient && (
            <Link href={`/clients/${project.client.id}`} className="text-[13px] text-brand hover:underline">
              {project.client.businessName}
            </Link>
          )}
          <ProjectStatusBadge status={project.status} />
          <ScheduleBadge schedule={s.schedule} daysOverdue={s.daysOverdue} />
          <PriorityBadge priority={project.priority} />
          {project.services.map((x) => (
            <Badge key={x.id} size="sm">
              {x.name}
            </Badge>
          ))}
        </div>
      </PageHeader>

      <Tabs items={tabs} active={tab} onChange={setTab} />

      {tab === "overview" && (s.pendingRoles > 0 || s.openSuggestions > 0) && (
        <button
          type="button"
          onClick={() => setTab("team")}
          className="flex w-full items-center justify-between gap-3 rounded-card border border-brand/40 bg-brand-tint px-5 py-3.5 text-left text-[13px] text-ink transition-colors hover:border-brand"
        >
          <span>
            {s.pendingRoles > 0 && `${s.pendingRoles} role${s.pendingRoles === 1 ? "" : "s"} in the team plan ${s.pendingRoles === 1 ? "is" : "are"} waiting for a decision. `}
            {s.openSuggestions > 0 && `${s.openSuggestions} reassignment${s.openSuggestions === 1 ? "" : "s"} suggested.`}
          </span>
          <span className="shrink-0 font-medium text-brand">Open the team plan →</span>
        </button>
      )}

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="min-w-0 space-y-6 lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard label="Progress" value={`${s.progress.percent}%`} hint={`${s.progress.done} of ${s.progress.total} ${s.progress.basis === "stages" ? "stages" : "units"}`} />
              <StatCard label="Deadline" value={formatDate(project.deadline)} hint={SCHEDULE_LABEL[s.schedule]} />
              <StatCard label="Open work" value={String(s.openMilestones + s.openTasks)} hint={`${s.openMilestones} milestones · ${s.openTasks} tasks`} />
            </div>

            <Card padded={false}>
              <CardHeader title="Progress" description={BASIS[s.progress.basis]} />
              <CardBody className="space-y-4">
                <ProgressBar value={s.progress.percent} showValue tone={progressTone(s.schedule)} />
                <div className="flex flex-wrap gap-2 text-[13px] text-ink-muted">
                  <span>Current stage{project.currentStages.length > 1 ? "s" : ""}:</span>
                  {project.currentStages.length ? (
                    project.currentStages.map((c) => (
                      <Badge key={c.id} tone="info" size="sm">
                        {c.service ? `${c.service}: ` : ""}
                        {c.name}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-ink-muted">every stage is done</span>
                  )}
                </div>
                <p className="flex items-start gap-1.5 text-[12px] text-ink-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Behind schedule means progress trails the share of time used by more than 25 points.
                </p>
              </CardBody>
            </Card>

            <Card padded={false}>
              <CardHeader title="Upcoming work" description="Open milestones and tasks due in the next two weeks, overdue first." />
              <CardBody>
                {project.upcoming.length ? (
                  <ul className="divide-y divide-line">
                    {project.upcoming.map((w) => {
                      const late = w.dueAt && Date.parse(w.dueAt) + 86_400_000 < Date.now();
                      return (
                        <li key={`${w.kind}-${w.id}`} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                          <span className="flex min-w-0 items-center gap-2">
                            <Badge size="sm">{w.kind === "MILESTONE" ? "Milestone" : "Task"}</Badge>
                            <span className="truncate text-ink">{w.title}</span>
                          </span>
                          <span className={late ? "shrink-0 tabular-nums text-danger-ink" : "shrink-0 tabular-nums text-ink-muted"}>
                            <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                            {w.dueAt ? formatDate(w.dueAt) : "—"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink-muted">Nothing due in the next two weeks.</p>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="min-w-0 space-y-6">
            <Card padded={false}>
              <CardHeader title="Details" />
              <CardBody className="space-y-4">
                {viewer.canShape ? (
                  <>
                    <Select label="Status" value={project.status} onChange={(e) => void patch({ status: e.target.value }, "Status updated")} options={PROJECT_STATUSES.map((x) => ({ value: x, label: PROJECT_STATUS_LABEL[x] }))} />
                    <Select label="Priority" value={project.priority} onChange={(e) => void patch({ priority: e.target.value }, "Priority updated")} options={PROJECT_PRIORITIES.map((x) => ({ value: x, label: PROJECT_PRIORITY_LABEL[x] }))} />
                    <DateField label="Start" value={project.startDate} onSave={(v) => patch({ startDate: v }, "Start date moved")} />
                    <DateField label="Deadline" value={project.deadline} onSave={(v) => patch({ deadline: v }, "Deadline moved — the team was told")} />
                  </>
                ) : (
                  <dl className="space-y-2 text-[13px]">
                    <Row k="Status" v={PROJECT_STATUS_LABEL[project.status]} />
                    <Row k="Start" v={formatDate(project.startDate)} />
                    <Row k="Deadline" v={formatDate(project.deadline)} />
                  </dl>
                )}
                {project.completedAt && <p className="text-[12px] text-ink-muted">Completed {formatDate(project.completedAt)}</p>}
              </CardBody>
            </Card>
            <Card padded={false}>
              <CardHeader title="Team" action={<button type="button" onClick={() => setTab("team")} className="text-[13px] text-brand hover:underline">Manage</button>} />
              <CardBody>
                {project.team.length ? (
                  <ul className="space-y-2.5">
                    {project.team.map((m) => (
                      <li key={m.id} className="flex items-center gap-2.5 text-[13px]">
                        <Avatar name={m.name} color={m.avatarColor} size="sm" />
                        <span className="truncate text-ink">{m.name}</span>
                        {m.projectRole === "LEAD" && <Badge size="sm" tone="info">Lead</Badge>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-[13px] text-ink-muted">No one is on this project yet.</p>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}

      {tab === "plan" && <ProjectPlan project={project} viewer={viewer} onChanged={load} />}
      {tab === "tasks" && <ProjectTasks project={project} viewer={viewer} onChanged={load} />}
      {tab === "updates" && <ProjectUpdates projectId={project.id} viewerId={viewerId} />}
      {tab === "files" && (
        <Card padded={false}>
          <CardBody>
            <FilesPanel owner={{ projectId: project.id }} canUpload={viewer.canWork} canChangeVisibility={viewer.canShape} viewerId={viewerId} />
          </CardBody>
        </Card>
      )}
      {tab === "team" && <ProjectTeam project={project} viewer={viewer} onChanged={load} />}
      {tab === "discussion" && <ProjectDiscussion projectId={project.id} canPost={viewer.canWork} viewerId={viewerId} />}
      {tab === "logins" && viewer.canSeeCredentials && (
        <Card padded={false}>
          <CardHeader title={`${project.client.businessName} logins`} />
          <CardBody>
            <CredentialsPanel clientId={project.client.id} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="tabular-nums text-ink">{v}</dd>
    </div>
  );
}

/** Saves on blur; a refused date snaps back to the saved one. */
function DateField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <Input
      type="date"
      label={label}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={async () => {
        if (!draft || draft === value) return setDraft(value);
        if (!(await onSave(draft))) setDraft(value);
      }}
    />
  );
}
