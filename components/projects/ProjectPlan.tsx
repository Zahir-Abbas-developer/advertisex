"use client";

import { useMemo, useState } from "react";
import { Check, CircleDot, Circle, Plus, Trash2 } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import type { ProjectPayload, ProjectViewer } from "@/components/projects/types";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/safe-fetch";

type Stage = ProjectPayload["stages"][number];
type Milestone = ProjectPayload["milestones"][number];

/**
 * The plan (Phase 4 scope 3): one line of stages per service, each stage's
 * milestones beneath it, and milestones not tied to a stage at the end.
 * Completing a stage starts the next one.
 */
export function ProjectPlan({ project, viewer, onChanged }: { project: ProjectPayload; viewer: ProjectViewer; onChanged: () => void }) {
  const toast = useToast();
  const [adding, setAdding] = useState<{ stageId: string | null } | null>(null);
  const [newStage, setNewStage] = useState<{ serviceId: string | null } | null>(null);

  const lines = useMemo(() => {
    const map = new Map<string, { key: string; name: string; serviceId: string | null; stages: Stage[] }>();
    for (const s of project.stages) {
      const key = s.serviceId ?? "general";
      const line = map.get(key) ?? { key, name: s.service ?? "General", serviceId: s.serviceId, stages: [] };
      line.stages.push(s);
      map.set(key, line);
    }
    return [...map.values()].map((l) => ({ ...l, stages: l.stages.sort((a, b) => a.order - b.order) }));
  }, [project.stages]);

  const call = async (url: string, method: string, body: unknown, done: string) => {
    const res = await safeFetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(data.error ?? "That didn't save");
      return false;
    }
    toast.success(done);
    onChanged();
    return true;
  };

  const base = `/api/projects/${project.id}`;
  const milestonesOf = (stageId: string | null) => project.milestones.filter((m) => m.stageId === stageId);

  return (
    <div className="space-y-6">
      {lines.map((line) => (
        <Card padded={false} key={line.key}>
          <CardHeader
            title={line.name}
            description={`${line.stages.filter((s) => s.status === "DONE").length} of ${line.stages.length} stages done`}
            action={
              viewer.canShape ? (
                <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setNewStage({ serviceId: line.serviceId })}>
                  Stage
                </Button>
              ) : undefined
            }
          />
          <CardBody className="space-y-5">
            {/* The line at a glance, left to right. */}
            <ol className="flex flex-wrap items-center gap-1.5" aria-label={`${line.name} stages`}>
              {line.stages.map((s, i) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-pill border px-2.5 py-1 text-[12px]",
                      s.status === "DONE" ? "border-success/30 bg-success-tint text-success-ink" : s.status === "ACTIVE" ? "border-brand/50 bg-brand-tint text-ink" : "border-line text-ink-muted",
                    )}
                  >
                    {s.name}
                  </span>
                  {i < line.stages.length - 1 && <span className="text-ink-muted">→</span>}
                </li>
              ))}
            </ol>

            <ul className="space-y-4">
              {line.stages.map((s) => (
                <li key={s.id} className="rounded-[12px] border border-line p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {s.status === "DONE" ? <Check className="h-4 w-4 text-success-ink" /> : s.status === "ACTIVE" ? <CircleDot className="h-4 w-4 text-brand" /> : <Circle className="h-4 w-4 text-ink-muted" />}
                      <span className="text-[14px] font-medium text-ink">{s.name}</span>
                      {s.status === "ACTIVE" && <Badge size="sm" tone="info">Current</Badge>}
                      {s.completedAt && <span className="text-[12px] text-ink-muted">done {formatDate(s.completedAt)}</span>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {viewer.canWork && s.status !== "DONE" && (
                        <Button size="sm" variant="secondary" onClick={() => void call(`${base}/stages/${s.id}`, "PATCH", { status: "DONE" }, `${s.name} complete`)}>
                          Complete stage
                        </Button>
                      )}
                      {viewer.canWork && s.status === "PENDING" && (
                        <Button size="sm" variant="ghost" onClick={() => void call(`${base}/stages/${s.id}`, "PATCH", { status: "ACTIVE" }, `${s.name} started`)}>
                          Start
                        </Button>
                      )}
                      {viewer.canWork && s.status === "DONE" && (
                        <Button size="sm" variant="ghost" onClick={() => void call(`${base}/stages/${s.id}`, "PATCH", { status: "ACTIVE" }, `${s.name} reopened`)}>
                          Reopen
                        </Button>
                      )}
                      {viewer.canShape && (
                        <>
                          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding({ stageId: s.id })}>
                            Milestone
                          </Button>
                          <button
                            type="button"
                            className="rounded p-1.5 text-ink-muted hover:bg-surface-2 hover:text-danger-ink"
                            aria-label={`Remove stage ${s.name}`}
                            onClick={() => window.confirm(`Remove the stage "${s.name}"? Its milestones stay, unstaged.`) && void call(`${base}/stages/${s.id}`, "DELETE", null, "Stage removed")}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <MilestoneList items={milestonesOf(s.id)} viewer={viewer} base={base} call={call} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}

      <Card padded={false}>
        <CardHeader
          title="Milestones outside a stage"
          action={
            viewer.canShape ? (
              <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding({ stageId: null })}>
                Milestone
              </Button>
            ) : undefined
          }
        />
        <CardBody>
          {milestonesOf(null).length ? <MilestoneList items={milestonesOf(null)} viewer={viewer} base={base} call={call} /> : <p className="text-[13px] text-ink-muted">None.</p>}
        </CardBody>
      </Card>

      {adding && <MilestoneModal project={project} stageId={adding.stageId} onClose={() => setAdding(null)} onSave={(body) => call(`${base}/milestones`, "POST", body, "Milestone added")} />}
      {newStage && <StageModal onClose={() => setNewStage(null)} onSave={(name) => call(`${base}/stages`, "POST", { name, serviceId: newStage.serviceId }, "Stage added")} />}
    </div>
  );
}

function MilestoneList({
  items,
  viewer,
  base,
  call,
}: {
  items: Milestone[];
  viewer: ProjectViewer;
  base: string;
  call: (url: string, method: string, body: unknown, done: string) => Promise<boolean>;
}) {
  if (!items.length) return null;
  return (
    <ul className="mt-3 divide-y divide-line border-t border-line">
      {items.map((m) => {
        const late = m.status === "OPEN" && m.dueDate && Date.parse(m.dueDate) + 86_400_000 < Date.now();
        return (
          <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5">
            <button
              type="button"
              disabled={!viewer.canWork}
              onClick={() => void call(`${base}/milestones/${m.id}`, "PATCH", { status: m.status === "DONE" ? "OPEN" : "DONE" }, m.status === "DONE" ? "Milestone reopened" : "Milestone reached")}
              aria-label={m.status === "DONE" ? `Reopen ${m.title}` : `Mark ${m.title} done`}
              aria-pressed={m.status === "DONE"}
              className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors", m.status === "DONE" ? "border-success bg-success text-on-brand" : "border-line hover:border-ink/40", !viewer.canWork && "cursor-default")}
            >
              {m.status === "DONE" && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
            </button>
            <span className={cn("min-w-0 flex-1 truncate text-[13px]", m.status === "DONE" ? "text-ink-muted line-through" : "text-ink")}>{m.title}</span>
            <span className="text-[11px] tabular-nums text-ink-muted" title="Weight: how much of the project this represents">
              ×{m.weight}
            </span>
            {m.dueDate && <span className={cn("text-[12px] tabular-nums", late ? "text-danger-ink" : "text-ink-muted")}>{formatDate(m.dueDate)}</span>}
            {m.assignee && <Avatar name={m.assignee.name} color={m.assignee.avatarColor} size="sm" />}
            {viewer.canShape && (
              <button
                type="button"
                className="rounded p-1 text-ink-muted hover:text-danger-ink"
                aria-label={`Remove ${m.title}`}
                onClick={() => window.confirm(`Remove "${m.title}"?`) && void call(`${base}/milestones/${m.id}`, "DELETE", null, "Milestone removed")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MilestoneModal({ project, stageId, onClose, onSave }: { project: ProjectPayload; stageId: string | null; onClose: () => void; onSave: (body: unknown) => Promise<boolean> }) {
  const [form, setForm] = useState({ title: "", dueDate: "", weight: "1", assigneeId: "", stageId: stageId ?? "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const ok = await onSave({ title: form.title, dueDate: form.dueDate || null, weight: Number(form.weight), assigneeId: form.assigneeId || null, stageId: form.stageId || null });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal open onClose={onClose} title="Add a milestone" busy={busy} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={form.title.trim().length < 2} onClick={() => void save()}>Add</Button></>}>
      <div className="space-y-4">
        <Input label="Milestone" requiredMark value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Homepage design approved" />
        <Select label="Stage" value={form.stageId} onChange={(e) => setForm((f) => ({ ...f, stageId: e.target.value }))} options={[{ value: "", label: "No stage" }, ...project.stages.map((s) => ({ value: s.id, label: `${s.service ? `${s.service} · ` : ""}${s.name}` }))]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Due" type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
          <Select
            label="Weight"
            hint="How much of the project it represents"
            value={form.weight}
            onChange={(e) => setForm((f) => ({ ...f, weight: e.target.value }))}
            options={["1", "2", "3", "4", "5"].map((w) => ({ value: w, label: w === "1" ? "1 — small" : w === "5" ? "5 — major" : w }))}
          />
        </div>
        <Select label="Owner" value={form.assigneeId} onChange={(e) => setForm((f) => ({ ...f, assigneeId: e.target.value }))} options={[{ value: "", label: "Unassigned" }, ...project.team.map((m) => ({ value: m.id, label: m.name }))]} />
      </div>
    </Modal>
  );
}

function StageModal({ onClose, onSave }: { onClose: () => void; onSave: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a stage"
      description="Added at the end of this line."
      busy={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              const ok = await onSave(name);
              setBusy(false);
              if (ok) onClose();
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <Input label="Stage name" requiredMark value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Content review" />
    </Modal>
  );
}
