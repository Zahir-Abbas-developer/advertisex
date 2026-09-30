"use client";

import { useState } from "react";
import { ListTodo, Plus } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { TaskDrawer, type DrawerTask } from "@/components/tasks/TaskDrawer";
import type { ProjectPayload, ProjectViewer } from "@/components/projects/types";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from "@/lib/constants";
import { formatDate } from "@/lib/date";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/modules/tasks/domain";
import { safeFetch } from "@/lib/safe-fetch";

const TONE: Record<TaskStatus, "neutral" | "info" | "warning" | "success"> = {
  NOT_STARTED: "neutral",
  IN_PROGRESS: "info",
  REVIEW: "warning",
  COMPLETED: "success",
};

/**
 * The project's tasks (Phase 2 tasks, now attached to projects). Each counts
 * 1 toward progress; opening one shows its checklist, comments, files and
 * history.
 */
export function ProjectTasks({ project, viewer, onChanged }: { project: ProjectPayload; viewer: ProjectViewer; onChanged: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState<DrawerTask | null>(null);
  const [form, setForm] = useState({ title: "", dueAt: "", assigneeId: "", priority: "MEDIUM" });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    const res = await safeFetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: project.id, title: form.title, dueAt: form.dueAt || null, assigneeId: form.assigneeId || null, priority: form.priority }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(Object.values(body.fields ?? {})[0] as string ?? body.error ?? "The task wasn't added");
    setForm({ title: "", dueAt: "", assigneeId: "", priority: "MEDIUM" });
    toast.success("Task added");
    onChanged();
  };

  return (
    <Card padded={false}>
      <CardBody className="space-y-5">
        {viewer.canWork && (
          <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <Input label="New task" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="What needs doing" />
            <Input label="Due" type="date" value={form.dueAt} onChange={(e) => setForm((f) => ({ ...f, dueAt: e.target.value }))} />
            <Select label="Assignee" value={form.assigneeId} onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))} options={[{ value: "", label: "Me" }, ...project.team.map((m) => ({ value: m.id, label: m.name }))]} />
            <Select label="Priority" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} options={TASK_PRIORITIES.map((p) => ({ value: p, label: TASK_PRIORITY_LABEL[p] }))} />
            <Button icon={<Plus className="h-4 w-4" />} loading={busy} disabled={form.title.trim().length < 2} onClick={() => void add()}>
              Add
            </Button>
          </div>
        )}
        {project.tasks.length === 0 ? (
          <EmptyState icon={ListTodo} title="No tasks yet" description="Tasks here count toward the project's progress." className="py-8" />
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line">
            {project.tasks.map((t) => {
              const status = t.status as TaskStatus;
              const late = status !== "COMPLETED" && t.dueAt && Date.parse(t.dueAt) + 86_400_000 < Date.now();
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => setOpen({ id: t.id, title: t.title, note: null, status, dueAt: t.dueAt })} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
                    <Badge dot tone={TONE[status]} size="sm">
                      {TASK_STATUS_LABEL[status]}
                    </Badge>
                    <span className={status === "COMPLETED" ? "min-w-0 flex-1 truncate text-[13px] text-ink-muted line-through" : "min-w-0 flex-1 truncate text-[13px] text-ink"}>{t.title}</span>
                    {t.dueAt && <span className={late ? "text-[12px] tabular-nums text-danger-ink" : "text-[12px] tabular-nums text-ink-muted"}>{formatDate(t.dueAt)}</span>}
                    {t.assignee && <Avatar name={t.assignee.name} color={t.assignee.avatarColor} size="sm" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      <TaskDrawer task={open} onClose={() => setOpen(null)} onChanged={onChanged} />
    </Card>
  );
}
