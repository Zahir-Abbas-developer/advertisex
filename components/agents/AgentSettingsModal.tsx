"use client";

import { useState } from "react";

import type { AgentRow } from "@/modules/ai/agents/server";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";

export type CapabilityOption = { key: string; name: string; description: string; subjectType: string; tools: string[]; grants: string[] };

/**
 * Founder only: hire an agent (name + capability), or change one — its
 * capability (the grants it needs are added and recorded as yours), whether
 * it's working, its hourly limit and its monthly AI budget.
 */
export function AgentSettingsModal({ agent, capabilities, onClose, onSaved }: { agent: AgentRow | null; capabilities: CapabilityOption[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [capability, setCapability] = useState(agent?.capability?.key ?? capabilities[0]?.key ?? "");
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const [perHour, setPerHour] = useState(String(agent?.maxRunsPerHour ?? ""));
  const [budget, setBudget] = useState(agent?.monthlyBudgetMicros != null ? String(agent.monthlyBudgetMicros / 1_000_000) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cap = capabilities.find((c) => c.key === capability);

  const save = async () => {
    setError(null);
    const hourly = Number(perHour);
    const dollars = Number(budget);
    if (agent && (!Number.isInteger(hourly) || hourly < 1 || hourly > 500)) return setError("Runs per hour must be a whole number from 1 to 500");
    if (agent && (!Number.isFinite(dollars) || dollars < 0 || dollars > 1000)) return setError("The monthly budget must be between $0 and $1,000");
    setBusy(true);
    const res = agent
      ? await safeFetch(`/api/agents/${agent.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ capability, enabled, maxRunsPerHour: hourly, monthlyBudgetMicros: Math.round(dollars * 1_000_000) }) })
      : await safeFetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), capability }) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.fields?.name ?? body.error ?? "It couldn't be saved");
    toast.success(agent ? `${agent.name} updated` : `${name.trim()} joined the team`);
    onSaved();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow="AI employee"
      title={agent ? `${agent.name}'s settings` : "Hire an agent"}
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={!agent && !name.trim()} onClick={() => void save()}>
            {agent ? "Save" : "Hire"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!agent && <Input label="Name" placeholder="e.g. Nova" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} requiredMark />}
        <Select label="Capability" value={capability} onChange={(e) => setCapability(e.target.value)} options={capabilities.map((c) => ({ value: c.key, label: c.name }))} />
        {cap && (
          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px]">
            <p className="text-ink-2">{cap.description}</p>
            <p className="mt-1.5 text-[12px] text-ink-muted">Permissions it needs: {cap.grants.join(", ")}</p>
          </div>
        )}
        {agent && (
          <>
            <Checkbox label="Working" hint="Paused agents take no new work; automations skip them." checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Runs per hour" inputMode="numeric" hint="More are queued, not dropped." value={perHour} onChange={(e) => setPerHour(e.target.value)} />
              <Input label="Monthly AI budget ($)" inputMode="decimal" hint="Past it, the agent works without AI." value={budget} onChange={(e) => setBudget(e.target.value)} />
            </div>
          </>
        )}
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
