"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { cn } from "@/lib/utils";
import { WEIGHT_LABEL, type Weights } from "@/modules/assignment/domain";

type Form = { mode: "RECOMMEND" | "AUTO"; weights: Weights; roleHours: number };

const HINT: Record<keyof Weights, string> = {
  skillMatch: "Proficiency in the role's skill, and breadth across the project's skills",
  availability: "Approved leave in the project's first two weeks",
  capacity: "Weekly hours still free (open work and project roles against capacity)",
  performance: "On-time delivery over the last six months",
  deadlineFit: "Other work already due before this project's deadline",
};

/**
 * The assignment settings (Phase 5): how projects are staffed and how
 * candidates are weighed. Weights are relative — they're shown as each
 * one's share of the score.
 */
export function AssignmentSettingsForm() {
  const toast = useToast();
  const [form, setForm] = useState<Form | null>(null);
  const [ai, setAi] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch("/api/settings/assignment", { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    const body = await res.json();
    setFailed(false);
    setAi(body.aiConfigured);
    setForm({ mode: body.mode, weights: body.weights, roleHours: body.roleHours });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <ErrorState title="Settings didn't load" onRetry={() => void load()} />;
  if (!form) return <Skeleton className="h-64 rounded-card" />;

  const total = Object.values(form.weights).reduce((a, b) => a + (Number(b) || 0), 0);
  const save = async () => {
    setBusy(true);
    const res = await safeFetch("/api/settings/assignment", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(body.error ?? "Couldn't save the settings");
    toast.success("Assignment settings saved");
  };

  return (
    <div className="max-w-3xl space-y-6">
      <Card padded={false}>
        <CardHeader title="When a project is created" />
        <CardBody className="grid gap-3 sm:grid-cols-2">
          {(["RECOMMEND", "AUTO"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={form.mode === mode}
              onClick={() => setForm({ ...form, mode })}
              className={cn("rounded-[12px] border p-4 text-left transition-colors", form.mode === mode ? "border-brand bg-brand-tint" : "border-line hover:border-ink/20")}
            >
              <span className="block text-[14px] font-medium text-ink">{mode === "RECOMMEND" ? "Recommend" : "Assign automatically"}</span>
              <span className="mt-1 block text-[13px] text-ink-muted">
                {mode === "RECOMMEND" ? "Suggest a person for each role; you confirm or change them." : "Put the best match on each role straight away; you can still change anyone."}
              </span>
            </button>
          ))}
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader title="How candidates are weighed" description="score = Σ weight × component, each component 0–100%. Only people who hold the skill and have room for it are ranked." />
        <CardBody className="space-y-4">
          {(Object.keys(WEIGHT_LABEL) as (keyof Weights)[]).map((k) => (
            <div key={k} className="grid items-center gap-3 sm:grid-cols-[1fr_7rem_4rem]">
              <div>
                <p className="text-[13px] font-medium text-ink">{WEIGHT_LABEL[k]}</p>
                <p className="text-[12px] text-ink-muted">{HINT[k]}</p>
              </div>
              <Input
                aria-label={`${WEIGHT_LABEL[k]} weight`}
                type="number"
                min={0}
                max={100}
                value={String(form.weights[k])}
                onChange={(e) => setForm({ ...form, weights: { ...form.weights, [k]: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) } })}
              />
              <span className="text-right text-[13px] tabular-nums text-ink-muted">{total ? Math.round((form.weights[k] / total) * 100) : 0}%</span>
            </div>
          ))}
          {total === 0 && <p className="text-[13px] text-danger-ink">At least one weight must be above zero.</p>}
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader title="Capacity" />
        <CardBody className="space-y-2">
          <div className="w-40">
            <Input label="Hours a role takes each week" type="number" min={1} max={40} value={String(form.roleHours)} onChange={(e) => setForm({ ...form, roleHours: Math.max(1, Math.min(40, Math.round(Number(e.target.value) || 1))) })} />
          </div>
          <p className="text-[12px] text-ink-muted">Each project role counts this much against a person&apos;s weekly capacity; open tasks and milestones count 2 hours each. No one is given a role that would take them over capacity.</p>
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader title="AI" />
        <CardBody>
          <p className="text-[13px] text-ink-2">
            {ai
              ? "On: a project's brief is read for skills the services don't cover (only skills from your taxonomy). Scoring itself never uses AI."
              : "Off: set ANTHROPIC_API_KEY to also read project briefs for required skills. Everything else works the same without it."}
          </p>
        </CardBody>
      </Card>

      <Button loading={busy} disabled={total === 0} onClick={() => void save()}>
        Save
      </Button>
    </div>
  );
}
