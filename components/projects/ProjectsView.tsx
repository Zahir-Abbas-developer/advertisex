"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, FolderKanban, Plus, Search } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Button, buttonClasses } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Tabs } from "@/components/ui/Tabs";
import { NewProjectModal } from "@/components/projects/shared/NewProjectModal";
import { PriorityBadge, ProjectStatusBadge, progressTone, ScheduleBadge } from "@/components/projects/shared/badges";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import { PROJECT_STATUS_LABEL, type ProjectStatus, type Schedule } from "@/modules/projects/domain";
import { safeFetch } from "@/lib/safe-fetch";

type Row = {
  id: string;
  title: string;
  status: ProjectStatus;
  priority: string;
  deadline: string;
  client: { id: string; businessName: string };
  owner: { id: string; name: string; avatarColor: string } | null;
  team: { id: string; name: string; avatarColor: string }[];
  services: { id: string; name: string }[];
  currentStage: string | null;
  progress: number;
  schedule: Schedule;
  daysOverdue: number;
  openMilestones: number;
  openTasks: number;
};

type Scope = "OPEN" | "COMPLETED" | "ALL";
const BOARD_COLUMNS: ProjectStatus[] = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];

/**
 * Projects (Phase 4 scope 4): a list and a board by status. Delayed projects
 * say so on the card; everything else stays quiet.
 */
export function ProjectsView({ canCreate, canSeeAnalytics }: { canCreate: boolean; canSeeAnalytics: boolean }) {
  const [view, setView] = useState<"board" | "list">("board");
  const [scope, setScope] = useState<Scope>("OPEN");
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    const q = new URLSearchParams({ status: scope === "COMPLETED" ? "COMPLETED" : scope, ...(mine ? { mine: "1" } : {}) });
    const res = await safeFetch(`/api/projects?${q}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setRows((await res.json()).projects);
  }, [scope, mine]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const n = query.trim().toLowerCase();
    return (rows ?? []).filter((r) => !n || r.title.toLowerCase().includes(n) || r.client.businessName.toLowerCase().includes(n));
  }, [rows, query]);

  const delayed = visible.filter((r) => r.schedule === "OVERDUE" || r.schedule === "BEHIND").length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Delivery"
        title="Projects"
        description="Every client project, where it stands against its deadline, and who is on it."
        actions={
          <>
            {canSeeAnalytics && (
              <Link href="/projects/analytics" className={buttonClasses("ghost", "md", "gap-2")}>
                <BarChart3 className="h-4 w-4" />
                Analytics
              </Link>
            )}
            {canCreate && (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
                New project
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["OPEN", "COMPLETED", "ALL"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              aria-pressed={scope === s}
              className={cn(
                "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                scope === s ? "border-brand/50 bg-brand-tint text-brand" : "border-line bg-surface text-ink-muted hover:border-ink/25 hover:text-ink",
              )}
            >
              {s === "OPEN" ? "Open" : s === "COMPLETED" ? "Completed" : "All"}
            </button>
          ))}
          <label className="ml-2 flex items-center gap-2 text-[13px] text-ink-muted">
            <input type="checkbox" className="accent-brand" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Only mine
          </label>
          {rows && delayed > 0 && <span className="ml-2 text-[13px] text-ink">{delayed} delayed</span>}
        </div>
        <div className="w-full sm:w-64">
          <Input aria-label="Search projects" placeholder="Search projects or clients" icon={<Search className="h-4 w-4" />} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <Tabs
        items={[
          { key: "board", label: "Board" },
          { key: "list", label: "List" },
        ]}
        active={view}
        onChange={setView}
      />

      {failed ? (
        <ErrorState title="Projects didn't load" onRetry={() => void load()} />
      ) : !rows ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-card" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState
            icon={FolderKanban}
            title={rows.length === 0 ? "No projects here yet" : "Nothing matches that search"}
            description={rows.length === 0 ? (canCreate ? "Start a project for a client — its services bring the stages and skills." : "Projects you're on will appear here.") : "Try another name."}
            action={rows.length === 0 && canCreate ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New project</Button> : undefined}
          />
        </div>
      ) : view === "board" ? (
        <div className={cn("grid gap-4 md:grid-cols-2", scope === "ALL" ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
          {BOARD_COLUMNS.filter((c) =>
            scope === "OPEN" ? c !== "COMPLETED" && c !== "CANCELLED" : scope === "COMPLETED" ? c === "COMPLETED" : true,
          ).map((column) => {
            const items = visible.filter((r) => r.status === column);
            return (
              <section key={column} className="min-w-0 space-y-3" aria-label={PROJECT_STATUS_LABEL[column]}>
                <h2 className="flex items-center justify-between text-[13px] font-medium text-ink-2">
                  {PROJECT_STATUS_LABEL[column]}
                  <span className="tabular-nums text-ink-muted">{items.length}</span>
                </h2>
                {items.length === 0 ? (
                  <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-[12px] text-ink/35">None</p>
                ) : (
                  items.map((r) => <ProjectCard key={r.id} row={r} />)
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <TableShell>
          <Table>
            <THead>
              <TR>
                <TH>Project</TH>
                <TH>Client</TH>
                <TH>Status</TH>
                <TH>Stage</TH>
                <TH className="w-40">Progress</TH>
                <TH>Deadline</TH>
                <TH>Owner</TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link href={`/projects/${r.id}`} className="font-medium text-ink hover:text-brand">
                      {r.title}
                    </Link>
                    <div className="mt-1 flex gap-1.5">
                      <ScheduleBadge schedule={r.schedule} daysOverdue={r.daysOverdue} />
                      <PriorityBadge priority={r.priority} />
                    </div>
                  </TD>
                  <TD className="text-ink-2">{r.client.businessName}</TD>
                  <TD>
                    <ProjectStatusBadge status={r.status} />
                  </TD>
                  <TD className="text-ink-muted">{r.currentStage ?? "—"}</TD>
                  <TD>
                    <ProgressBar value={r.progress} showValue size="sm" tone={progressTone(r.schedule)} />
                  </TD>
                  <TD className="tabular-nums text-ink-2">{formatDate(r.deadline)}</TD>
                  <TD className="text-ink-2">{r.owner?.name ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableShell>
      )}

      {canCreate && <NewProjectModal open={creating} onClose={() => setCreating(false)} />}
    </div>
  );
}

function ProjectCard({ row: r }: { row: Row }) {
  return (
    <Link href={`/projects/${r.id}`} className="group block rounded-card border border-line bg-surface p-4 transition-colors hover:border-ink/20">
      <p className="truncate text-[12px] text-ink-muted">{r.client.businessName}</p>
      <h3 className="mt-0.5 line-clamp-2 text-[14px] font-semibold leading-snug text-ink group-hover:text-brand">{r.title}</h3>
      <div className="mt-3">
        <ProgressBar value={r.progress} showValue size="sm" tone={progressTone(r.schedule)} />
      </div>
      <p className="mt-2 truncate text-[12px] text-ink-muted">
        {r.currentStage ? `${r.currentStage} · ` : ""}due {formatDate(r.deadline)}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <ScheduleBadge schedule={r.schedule} daysOverdue={r.daysOverdue} />
          <PriorityBadge priority={r.priority} />
        </div>
        <div className="flex -space-x-1.5">
          {[...(r.owner ? [r.owner] : []), ...r.team.filter((t) => t.id !== r.owner?.id)].slice(0, 4).map((p) => (
            <Avatar key={p.id} name={p.name} color={p.avatarColor} size="sm" className="ring-2 ring-surface" />
          ))}
        </div>
      </div>
    </Link>
  );
}
