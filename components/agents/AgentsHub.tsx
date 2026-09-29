"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Play, Plus, Settings2 } from "lucide-react";

import type { AgentRow } from "@/modules/ai/agents/server";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { safeFetch } from "@/lib/safe-fetch";
import { ago, formatCost, formatRate } from "@/components/agents/shared";
import { AgentRuns } from "@/components/agents/AgentRuns";
import { GiveWorkModal } from "@/components/agents/GiveWorkModal";
import { AgentSettingsModal, type CapabilityOption } from "@/components/agents/AgentSettingsModal";

type Data = { agents: AgentRow[]; capabilities: CapabilityOption[] };

/**
 * AI employees (Phase 9 scope 5): who they are, what they do, how they're
 * doing — runs completed, approval rate, spend — and their work log. No
 * attendance: agents don't clock in.
 */
export function AgentsHub({ canHire, canAssign }: { canHire: boolean; canAssign: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState<AgentRow | null>(null);
  const [editing, setEditing] = useState<AgentRow | "new" | null>(null);
  const [runsVersion, setRunsVersion] = useState(0);

  const load = useCallback(async () => {
    const res = await safeFetch("/api/agents", { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, []);

  useEffect(() => void load(), [load]);

  const refresh = () => {
    void load();
    setRunsVersion((v) => v + 1);
  };

  const totals = data?.agents.reduce(
    (t, a) => ({ done: t.done + a.performance.done, awaiting: t.awaiting + a.performance.awaiting, approved: t.approved + a.performance.approved, rejected: t.rejected + a.performance.rejected, cost: t.cost + (a.performance.costMonthMicros ?? 0) }),
    { done: 0, awaiting: 0, approved: 0, rejected: 0, cost: 0 },
  );
  const showCost = data?.agents.some((a) => a.performance.costMonthMicros !== null) ?? false;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Team"
        title="AI employees"
        description="Agents that do real work on your records. Everything they do is logged; anything that reaches a client, closes a deal or bills money waits for a person."
        actions={
          canHire ? (
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing("new")}>
              Hire an AI employee
            </Button>
          ) : undefined
        }
      />

      {failed ? (
        <ErrorState title="AI employees didn't load" onRetry={() => void load()} />
      ) : !data || !totals ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-card" />
          ))}
        </div>
      ) : data.agents.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={Bot} title="No AI employees yet" description="Hire one with a capability — lead qualification is a good first." action={canHire ? <Button onClick={() => setEditing("new")}>Hire an AI employee</Button> : undefined} />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard variant="hero" label="Work completed" value={totals.done} hint="Runs finished, all time" />
            <StatCard label="Waiting on a person" value={totals.awaiting} hint="Runs with a proposal to decide" />
            <StatCard label="Approval rate" value={formatRate(totals.approved + totals.rejected ? totals.approved / (totals.approved + totals.rejected) : null)} hint={`${totals.approved} approved · ${totals.rejected} rejected`} />
            {showCost ? <StatCard label="AI spend this month" value={formatCost(totals.cost)} hint="Across all agents" /> : <StatCard label="Agents" value={data.agents.length} hint={`${data.agents.filter((a) => a.enabled).length} working`} />}
          </div>

          <section aria-labelledby="agents-roster" className="space-y-3">
            <h2 id="agents-roster" className="font-display text-[15px] font-semibold text-ink-heading">
              The roster
            </h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.agents.map((a) => (
                <AgentCard key={a.id} agent={a} canAssign={canAssign} canEdit={canHire} onGiveWork={() => setWorking(a)} onEdit={() => setEditing(a)} />
              ))}
            </div>
          </section>
        </>
      )}

      <AgentRuns agents={data?.agents ?? []} version={runsVersion} />

      {working && <GiveWorkModal agent={working} onClose={() => setWorking(null)} onStarted={refresh} />}
      {editing && data && <AgentSettingsModal agent={editing === "new" ? null : editing} capabilities={data.capabilities} onClose={() => setEditing(null)} onSaved={refresh} />}
    </div>
  );
}

function AgentCard({ agent: a, canAssign, canEdit, onGiveWork, onEdit }: { agent: AgentRow; canAssign: boolean; canEdit: boolean; onGiveWork: () => void; onEdit: () => void }) {
  const p = a.performance;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar name={a.name} color={a.avatarColor} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-display text-[15px] font-semibold text-ink">{a.name}</p>
            {a.enabled ? (
              <Badge tone="success" dot size="sm">
                Working
              </Badge>
            ) : (
              <Badge tone="neutral" dot size="sm">
                Paused
              </Badge>
            )}
          </div>
          <p className="text-[13px] text-ink-muted">{a.capability?.name ?? "No capability"}</p>
        </div>
        {canEdit && (
          <Button variant="ghost" size="sm" aria-label={`${a.name} settings`} icon={<Settings2 className="h-4 w-4" />} onClick={onEdit} />
        )}
      </div>
      <p className="text-[13px] leading-relaxed text-ink-2">{a.capability?.description ?? "Give this agent a capability to put it to work."}</p>
      {a.missingGrants.length > 0 && <p className="text-[12px] text-ink-muted">Missing permissions: {a.missingGrants.join(", ")} — its runs will fail until a founder grants them.</p>}
      <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4 text-[12px]">
        <div>
          <dt className="text-ink-muted">Completed</dt>
          <dd className="mt-0.5 font-display text-[18px] font-semibold tabular-nums text-ink">{p.done}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Approval rate</dt>
          <dd className="mt-0.5 font-display text-[18px] font-semibold tabular-nums text-ink">{formatRate(p.approvalRate)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">{p.costMonthMicros !== null ? "Spend (month)" : "Failed"}</dt>
          <dd className="mt-0.5 font-display text-[18px] font-semibold tabular-nums text-ink">{p.costMonthMicros !== null ? formatCost(p.costMonthMicros) : p.failed}</dd>
        </div>
      </dl>
      <div className="mt-auto flex items-center justify-between gap-3">
        <span className="text-[12px] text-ink-muted">{p.lastRunAt ? `Last worked ${ago(p.lastRunAt)}` : "Hasn't worked yet"}</span>
        {canAssign && a.capability && a.enabled && (
          <Button variant="secondary" size="sm" icon={<Play className="h-4 w-4" />} onClick={onGiveWork}>
            Give work
          </Button>
        )}
      </div>
    </Card>
  );
}
