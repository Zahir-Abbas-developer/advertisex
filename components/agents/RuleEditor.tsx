"use client";

import { useState } from "react";

import type { RuleRow } from "@/modules/ai/agents/rules";
import type { AgentRow } from "@/modules/ai/agents/server";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";

export type Option = { value: string; label: string };

const TRIGGERS: (Option & { subjects: string[] })[] = [
  { value: "LEAD_CREATED", label: "A lead is created", subjects: ["lead"] },
  { value: "LEAD_STAGE_CHANGED", label: "A lead changes stage", subjects: ["lead"] },
  { value: "DEADLINE_NEAR", label: "A task's deadline is near", subjects: ["lead", "client", "project"] },
  { value: "REPORT_DUE", label: "A client's monthly report is due", subjects: ["client"] },
];
const ACTIONS: Option[] = [
  { value: "RUN_AGENT", label: "Give an AI employee the work" },
  { value: "NOTIFY", label: "Notify people" },
  { value: "CREATE_TASK", label: "Create a task" },
];
const STAGE_KINDS: Option[] = [
  { value: "WON", label: "Won" },
  { value: "LOST", label: "Lost" },
  { value: "ACTIVE_CLIENT", label: "Active client" },
  { value: "OPEN", label: "In progress" },
];

/** Create or edit one rule. The server validates it again against this organization. */
export function RuleEditor({ rule, agents, departments, sources, onClose, onSaved }: { rule: RuleRow | null; agents: AgentRow[]; departments: { id: string; name: string }[]; sources: Option[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const cfg = rule?.actionConfig ?? {};
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState(rule?.trigger ?? "LEAD_CREATED");
  const [action, setAction] = useState<string>(rule?.action ?? "RUN_AGENT");
  const [deptIds, setDeptIds] = useState<string[]>(rule?.conditions.departmentId ?? []);
  const [source, setSource] = useState<string[]>(rule?.conditions.source ?? []);
  const [kinds, setKinds] = useState<string[]>(rule?.conditions.toStageKind ?? []);
  const [agentId, setAgentId] = useState(String(cfg.agentId ?? ""));
  const [to, setTo] = useState(String(cfg.to ?? "owner"));
  const [message, setMessage] = useState(String(cfg.message ?? ""));
  const [title, setTitle] = useState(String(cfg.title ?? ""));
  const [dueInDays, setDueInDays] = useState(cfg.dueInDays !== undefined ? String(cfg.dueInDays) : "2");
  const [assignTo, setAssignTo] = useState(String(cfg.assignTo ?? "owner"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subjects = TRIGGERS.find((t) => t.value === trigger)!.subjects;
  const fitting = agents.filter((a) => a.capability && (a.capability.subjectType === "organization" || subjects.includes(a.capability.subjectType)));
  const flip = (list: string[], set: (v: string[]) => void, value: string, on: boolean) => set(on ? [...list, value] : list.filter((v) => v !== value));

  const save = async () => {
    setError(null);
    const actionConfig = action === "RUN_AGENT" ? { agentId } : action === "NOTIFY" ? { to, message: message.trim() } : { title: title.trim(), assignTo, ...(dueInDays.trim() ? { dueInDays: Number(dueInDays) } : {}) };
    const conditions = { ...(deptIds.length ? { departmentId: deptIds } : {}), ...(trigger === "LEAD_CREATED" && source.length ? { source } : {}), ...(trigger === "LEAD_STAGE_CHANGED" && kinds.length ? { toStageKind: kinds } : {}) };
    setBusy(true);
    const res = await safeFetch(rule ? `/api/automations/${rule.id}` : "/api/automations", {
      method: rule ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), enabled: rule?.enabled ?? true, trigger, conditions, action, actionConfig }),
    });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.fields?.name ?? body.error ?? "It couldn't be saved");
    toast.success(rule ? "Automation saved" : "Automation created");
    onSaved();
    onClose();
  };

  const ready = name.trim() && (action === "RUN_AGENT" ? agentId : action === "NOTIFY" ? message.trim() : title.trim());

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="Automation"
      title={rule ? "Edit automation" : "New automation"}
      size="lg"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!ready} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Input label="Name" maxLength={80} placeholder="e.g. Qualify every new lead" value={name} onChange={(e) => setName(e.target.value)} requiredMark />
        <Select label="When" value={trigger} onChange={(e) => setTrigger(e.target.value as typeof trigger)} options={TRIGGERS} />
        <fieldset className="space-y-2">
          <legend className="text-[13px] font-medium text-ink">Only in these departments</legend>
          <p className="text-[12px] text-ink-muted">Leave all unticked for every department.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {departments.map((d) => (
              <Checkbox key={d.id} label={d.name} checked={deptIds.includes(d.id)} onChange={(e) => flip(deptIds, setDeptIds, d.id, e.target.checked)} />
            ))}
          </div>
        </fieldset>
        {trigger === "LEAD_CREATED" && (
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-ink">Only from these sources</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {sources.map((s) => (
                <Checkbox key={s.value} label={s.label} checked={source.includes(s.value)} onChange={(e) => flip(source, setSource, s.value, e.target.checked)} />
              ))}
            </div>
          </fieldset>
        )}
        {trigger === "LEAD_STAGE_CHANGED" && (
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium text-ink">Only when it moves to</legend>
            <div className="grid gap-2 sm:grid-cols-4">
              {STAGE_KINDS.map((k) => (
                <Checkbox key={k.value} label={k.label} checked={kinds.includes(k.value)} onChange={(e) => flip(kinds, setKinds, k.value, e.target.checked)} />
              ))}
            </div>
          </fieldset>
        )}
        <Select label="Then" value={action} onChange={(e) => setAction(e.target.value)} options={ACTIONS} />
        {action === "RUN_AGENT" && (
          <Select
            label="AI employee"
            hint={fitting.length ? "Only agents that work on what this trigger gives them." : "No agent works on what this trigger gives — hire one first."}
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="Choose an agent"
            options={fitting.map((a) => ({ value: a.id, label: `${a.name} — ${a.capability!.name}` }))}
          />
        )}
        {action === "NOTIFY" && (
          <div className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
            <Select label="Who" value={to} onChange={(e) => setTo(e.target.value)} options={[{ value: "owner", label: "The owner" }, { value: "managers", label: "Department managers" }, { value: "founders", label: "Founders" }]} />
            <Input label="Message" maxLength={200} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        )}
        {action === "CREATE_TASK" && (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px_180px]">
            <Input label="Task" maxLength={160} value={title} onChange={(e) => setTitle(e.target.value)} />
            <Input label="Due in (days)" inputMode="numeric" value={dueInDays} onChange={(e) => setDueInDays(e.target.value)} />
            <Select label="Assign to" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} options={[{ value: "owner", label: "The owner" }, { value: "unassigned", label: "No one yet" }]} />
          </div>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-danger-ink">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
