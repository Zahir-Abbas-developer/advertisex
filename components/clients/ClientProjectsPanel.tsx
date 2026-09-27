"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { FolderKanban, Plus } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { PriorityBadge, ProjectStatusBadge, progressTone, ScheduleBadge } from "@/components/projects/shared/badges";
import { formatDate } from "@/lib/date";
import type { Schedule } from "@/modules/projects/domain";
import { safeFetch } from "@/lib/safe-fetch";

type Row = {
  id: string;
  title: string;
  status: string;
  priority: string;
  deadline: string;
  progress: number;
  schedule: Schedule;
  daysOverdue: number;
  currentStage: string | null;
  services: { id: string; name: string }[];
};

/** Every project for one client, open ones first. */
export function ClientProjectsPanel({ clientId, canCreate, onNew }: { clientId: string; canCreate: boolean; onNew: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/projects?clientId=${clientId}&status=ALL`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    const list: Row[] = (await res.json()).projects;
    const closed = (s: string) => s === "COMPLETED" || s === "CANCELLED";
    setRows([...list].sort((a, b) => Number(closed(a.status)) - Number(closed(b.status)) || a.deadline.localeCompare(b.deadline)));
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) return <ErrorState title="Projects didn't load" onRetry={() => void load()} />;
  if (!rows) return <Skeleton className="h-40 rounded-card" />;
  if (rows.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="A project plans the work for the services this client bought — stages, milestones, tasks and a team."
          action={canCreate ? <Button icon={<Plus className="h-4 w-4" />} onClick={onNew}>New project</Button> : undefined}
        />
      </Card>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {rows.map((p) => (
        <Link key={p.id} href={`/projects/${p.id}`} className="group rounded-card border border-line bg-surface p-5 transition-colors hover:border-ink/20">
          <div className="flex items-start justify-between gap-3">
            <h3 className="truncate text-[15px] font-semibold text-ink group-hover:text-brand">{p.title}</h3>
            <ProjectStatusBadge status={p.status} />
          </div>
          <p className="mt-1 truncate text-[12px] text-ink/45">{p.services.map((s) => s.name).join(" · ") || "No services"}</p>
          <div className="mt-4">
            <ProgressBar value={p.progress} showValue size="sm" tone={progressTone(p.schedule)} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-ink/50">
            <span>Due {formatDate(p.deadline)}</span>
            {p.currentStage && <span>· Now: {p.currentStage}</span>}
            <ScheduleBadge schedule={p.schedule} daysOverdue={p.daysOverdue} />
            <PriorityBadge priority={p.priority} />
          </div>
        </Link>
      ))}
    </div>
  );
}
