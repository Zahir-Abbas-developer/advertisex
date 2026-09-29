"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ListChecks } from "lucide-react";

import type { AgentRow, RunRow } from "@/modules/ai/agents/server";
import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { safeFetch } from "@/lib/safe-fetch";
import { ago, formatCost, RunStatusBadge } from "@/components/agents/shared";

const FILTERS = [
  { key: "", label: "All" },
  { key: "AWAITING_APPROVAL", label: "Awaiting approval" },
  { key: "RUNNING", label: "Working" },
  { key: "DONE", label: "Done" },
  { key: "FAILED", label: "Failed" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

/** The work log: every run the viewer may see, newest first. Refreshes itself while anything is in flight. */
export function AgentRuns({ agents, version }: { agents: AgentRow[]; version: number }) {
  const [filter, setFilter] = useState<Filter>("");
  const [agentId, setAgentId] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ runs: RunRow[]; total: number; pageSize: number } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page) });
    if (filter) params.set("status", filter);
    if (agentId) params.set("agentId", agentId);
    const res = await safeFetch(`/api/agents/runs?${params}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setData(await res.json());
  }, [filter, agentId, page]);

  useEffect(() => void load(), [load, version]);

  // While work is queued or running, check back every few seconds.
  const inFlight = data?.runs.some((r) => r.status === "QUEUED" || r.status === "RUNNING") ?? false;
  useEffect(() => {
    if (!inFlight) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [inFlight, load]);

  return (
    <section aria-labelledby="agents-work" className="space-y-3">
      <h2 id="agents-work" className="font-display text-[15px] font-semibold text-ink-heading">
        Work log
      </h2>
      <Tabs
        items={FILTERS.map((f) => ({ key: f.key, label: f.label }))}
        active={filter}
        onChange={(k) => {
          setFilter(k);
          setPage(1);
        }}
        right={
          <div className="mb-2 w-full sm:w-56">
            <Select aria-label="Filter by agent" value={agentId} onChange={(e) => { setAgentId(e.target.value); setPage(1); }} options={[{ value: "", label: "Every agent" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          </div>
        }
      />
      {failed ? (
        <ErrorState title="The work log didn't load" onRetry={() => void load()} />
      ) : !data ? (
        <Skeleton className="h-48 rounded-card" />
      ) : data.runs.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={ListChecks} title={filter || agentId ? "Nothing matches" : "No work yet"} description={filter || agentId ? "Try another filter." : "Work appears here as agents take it on — from a person or from an automation."} />
        </Card>
      ) : (
        <>
          <TableShell>
            <Table>
              <THead>
                <TR>
                  <TH>Agent</TH>
                  <TH>Work</TH>
                  <TH>Status</TH>
                  <TH>Asked by</TH>
                  <TH className="text-right">Cost</TH>
                  <TH className="text-right">When</TH>
                </TR>
              </THead>
              <TBody>
                {data.runs.map((r) => (
                  <TR key={r.id}>
                    <TD>
                      <span className="flex items-center gap-2">
                        <Avatar name={r.agent.name} color={r.agent.avatarColor} size="sm" />
                        <span className="text-ink">{r.agent.name}</span>
                      </span>
                    </TD>
                    <TD className="max-w-[360px]">
                      <Link href={`/agents/runs/${r.id}`} className="block truncate font-medium text-ink hover:text-brand">
                        {r.summary ?? `${r.capability} · ${r.subject.label}`}
                      </Link>
                      <span className="block truncate text-[12px] text-ink-muted">{r.status === "FAILED" && r.error ? r.error : `${r.capability} · ${r.subject.label}`}</span>
                    </TD>
                    <TD>
                      <RunStatusBadge status={r.status} />
                    </TD>
                    <TD className="text-ink-muted">{r.requestedBy ?? "—"}</TD>
                    <TD className="text-right tabular-nums text-ink-2">{r.costMicros === null ? "—" : r.mode === "RULES" && r.costMicros === 0 ? "No AI" : formatCost(r.costMicros)}</TD>
                    <TD className="whitespace-nowrap text-right text-ink-muted">{ago(r.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableShell>
          <Pagination page={page} pageCount={Math.ceil(data.total / data.pageSize)} onPageChange={setPage} />
        </>
      )}
    </section>
  );
}
