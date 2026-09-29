"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2, Workflow } from "lucide-react";

import type { RuleRow } from "@/modules/ai/agents/rules";
import type { AgentRow } from "@/modules/ai/agents/server";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { ago } from "@/components/agents/shared";
import { RuleEditor, type Option } from "@/components/agents/RuleEditor";

/** Founder-configured automations (Phase 9 scope 4): "when this happens, do that". */
export function AutomationsManager({ departments, sources }: { departments: { id: string; name: string }[]; sources: Option[] }) {
  const toast = useToast();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<RuleRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<RuleRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, a] = await Promise.all([safeFetch("/api/automations", { cache: "no-store" }), safeFetch("/api/agents", { cache: "no-store" })]);
    if (!r.ok || !a.ok) return setFailed(true);
    setFailed(false);
    setRules(((await r.json()) as { rules: RuleRow[] }).rules);
    setAgents(((await a.json()) as { agents: AgentRow[] }).agents);
  }, []);

  useEffect(() => void load(), [load]);

  const toggle = async (rule: RuleRow, enabled: boolean) => {
    setRules((rs) => rs?.map((r) => (r.id === rule.id ? { ...r, enabled } : r)) ?? null);
    const res = await safeFetch(`/api/automations/${rule.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
    if (!res.ok) {
      toast.error("Couldn't change it");
      void load();
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    const res = await safeFetch(`/api/automations/${deleting.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return toast.error("Couldn't delete it");
    toast.success("Automation deleted");
    setDeleting(null);
    void load();
  };

  const describe = (r: RuleRow) => {
    const parts: string[] = [];
    const c = r.conditions;
    if (c.departmentId?.length) parts.push(`in ${c.departmentId.map((id) => departments.find((d) => d.id === id)?.name ?? "a removed department").join(" or ")}`);
    if (c.source?.length) parts.push(`from ${c.source.map((s) => sources.find((o) => o.value === s)?.label ?? s).join(" or ")}`);
    if (c.toStageKind?.length) parts.push(`to ${c.toStageKind.map((k) => k.toLowerCase().replace("_", " ")).join(" or ")}`);
    const cfg = r.actionConfig;
    const then = r.action === "RUN_AGENT" ? `${agents.find((a) => a.id === cfg.agentId)?.name ?? "a removed agent"} takes it on` : r.action === "NOTIFY" ? `notify ${String(cfg.to)}: “${String(cfg.message)}”` : `create “${String(cfg.title)}” for ${cfg.assignTo === "owner" ? "the owner" : "no one yet"}`;
    const trigger = r.triggerLabel.charAt(0).toLowerCase() + r.triggerLabel.slice(1);
    return { when: `${trigger}${parts.length ? ` ${parts.join(", ")}` : ""}`, then };
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="AI employees"
        title="Automations"
        description="Rules that put agents and people to work the moment something happens. Each rule fires once per occasion."
        actions={
          <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")} disabled={!rules}>
            New automation
          </Button>
        }
      />
      {failed ? (
        <ErrorState title="Automations didn't load" onRetry={() => void load()} />
      ) : !rules ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28 rounded-card" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={Workflow} title="No automations yet" description="Start with “when a lead is created, qualify it”." action={<Button onClick={() => setEditing("new")}>New automation</Button>} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {rules.map((r) => {
            const d = describe(r);
            return (
              <li key={r.id}>
                <Card className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">{r.name}</p>
                      <Badge tone={r.enabled ? "success" : "neutral"} dot size="sm">
                        {r.enabled ? "On" : "Off"}
                      </Badge>
                    </div>
                    <p className="text-[13px] text-ink-2">
                      <span className="text-ink-muted">When</span> {d.when} <span className="text-ink-muted">→</span> {d.then}
                    </p>
                    <p className="text-[12px] text-ink-muted">
                      {r.fireCount ? `Fired ${r.fireCount} time${r.fireCount === 1 ? "" : "s"} · last ${ago(r.lastFiredAt!)}` : "Hasn't fired yet"}
                      {r.recent[0] ? ` · last time: ${outcomeLabel(r.recent[0].outcome)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Checkbox label="On" checked={r.enabled} onChange={(e) => void toggle(r, e.target.checked)} />
                    <Button variant="ghost" size="sm" aria-label={`Edit ${r.name}`} icon={<Pencil className="h-4 w-4" />} onClick={() => setEditing(r)} />
                    <Button variant="ghost" size="sm" aria-label={`Delete ${r.name}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleting(r)} />
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {editing && <RuleEditor rule={editing === "new" ? null : editing} agents={agents} departments={departments} sources={sources} onClose={() => setEditing(null)} onSaved={() => void load()} />}
      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this automation?"
        description={deleting ? `“${deleting.name}” stops firing. Work it already started is kept.` : undefined}
        size="sm"
        busy={busy}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </div>
  );
}

/** A firing's recorded outcome, in words. */
function outcomeLabel(outcome: string) {
  if (outcome.startsWith("queued run")) return "work handed over";
  if (outcome.startsWith("created task")) return "task created";
  if (outcome.startsWith("notified ")) return `${outcome.slice(9)} notified`;
  return outcome.replace(/^skipped: /, "skipped — ").replace(/^failed: /, "failed — ");
}
