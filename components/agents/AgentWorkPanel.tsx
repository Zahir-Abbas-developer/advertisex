"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import type { AgentRow, RunRow } from "@/modules/ai/agents/server";
import { StatCard } from "@/components/ui/StatCard";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { safeFetch } from "@/lib/safe-fetch";
import { ago, formatCost, formatRate, RunStatusBadge } from "@/components/agents/shared";

/**
 * An AI employee's work and performance, for team views (Phase 9 scope 5):
 * what it does, runs completed, approval rate, spend, and its latest runs.
 * `agentId` omitted → a compact table of every agent (team performance).
 */
export function AgentWorkPanel({ agentId }: { agentId?: string }) {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    void (async () => {
      const [a, r] = await Promise.all([safeFetch("/api/agents", { cache: "no-store" }), agentId ? safeFetch(`/api/agents/runs?agentId=${agentId}`, { cache: "no-store" }) : Promise.resolve(null)]);
      if (!a.ok || (r && !r.ok)) return setFailed(true);
      setAgents(((await a.json()) as { agents: AgentRow[] }).agents);
      if (r) setRuns(((await r.json()) as { runs: RunRow[] }).runs.slice(0, 6));
    })();
  }, [agentId]);

  if (failed) return <p className="text-[13px] text-ink-muted">Agent work couldn&apos;t load.</p>;
  if (!agents) return <Skeleton className="h-32 rounded-card" />;

  if (!agentId) {
    if (agents.length === 0) return <p className="text-[13px] text-ink-muted">No AI employees yet.</p>;
    return (
      <TableShell>
        <Table className="min-w-[560px]">
          <THead>
            <TR>
              <TH>Agent</TH>
              <TH className="text-right">Completed</TH>
              <TH className="text-right">Approval rate</TH>
              <TH className="text-right">Waiting</TH>
              <TH className="text-right">Failed</TH>
              <TH className="text-right">Spend (month)</TH>
            </TR>
          </THead>
          <TBody>
            {agents.map((a) => (
              <TR key={a.id}>
                <TD>
                  <Link href={`/team/${a.id}`} className="font-medium text-ink hover:text-brand">
                    {a.name}
                  </Link>
                  <span className="block text-[12px] text-ink-muted">{a.capability?.name ?? "No capability"}</span>
                </TD>
                <TD className="text-right tabular-nums">{a.performance.done}</TD>
                <TD className="text-right tabular-nums">{formatRate(a.performance.approvalRate)}</TD>
                <TD className="text-right tabular-nums">{a.performance.awaiting}</TD>
                <TD className="text-right tabular-nums">{a.performance.failed}</TD>
                <TD className="text-right tabular-nums">{a.performance.costMonthMicros === null ? "—" : formatCost(a.performance.costMonthMicros)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </TableShell>
    );
  }

  const agent = agents.find((a) => a.id === agentId);
  if (!agent) return <p className="text-[13px] text-ink-muted">This agent has no work profile yet.</p>;
  const p = agent.performance;
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-2">
        <span className="font-medium text-ink">{agent.capability?.name ?? "No capability"}</span>
        {agent.capability ? ` — ${agent.capability.description}` : ""}
        {!agent.enabled && " (paused)"}
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Work completed" value={String(p.done)} hint="runs, all time" />
        <StatCard label="Approval rate" value={formatRate(p.approvalRate)} hint={`${p.approved} approved · ${p.rejected} rejected`} />
        <StatCard label="Waiting on a person" value={String(p.awaiting)} />
        {p.costMonthMicros !== null ? <StatCard label="AI spend this month" value={formatCost(p.costMonthMicros)} hint={`${p.runsMonth} run${p.runsMonth === 1 ? "" : "s"}`} /> : <StatCard label="Failed" value={String(p.failed)} />}
      </div>
      {runs && runs.length > 0 && (
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {runs.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
              <Link href={`/agents/runs/${r.id}`} className="min-w-0 truncate text-ink hover:text-brand">
                {r.summary ?? `${r.capability} · ${r.subject.label}`}
              </Link>
              <span className="flex shrink-0 items-center gap-3">
                <RunStatusBadge status={r.status} />
                <span className="text-[12px] text-ink-muted">{ago(r.createdAt)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/agents" className="inline-block text-[13px] font-medium text-brand hover:underline">
        All AI employees and their work log
      </Link>
    </div>
  );
}
