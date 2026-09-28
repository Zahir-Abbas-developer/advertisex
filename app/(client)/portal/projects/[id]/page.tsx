import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, Circle, CircleDot, Megaphone } from "lucide-react";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { FilesPanel } from "@/components/files/FilesPanel";
import { formatDate, relativeFromNow } from "@/lib/date";
import { cn } from "@/lib/utils";
import { requireClientPage } from "@/modules/rbac/server";
import { portalProject } from "@/modules/portal/server";

export const metadata = { title: "Project · Advertise X" };

/**
 * One project, for the client (Phase 6 scope 3). Built from the allow-listed
 * view in modules/portal/views.ts: stages, milestone titles and dates,
 * shared updates and shared files — never tasks, internal notes, internal
 * updates or internal files. Another account's project is simply not found.
 */
export default async function PortalProject({ params }: { params: { id: string } }) {
  const principal = await requireClientPage();
  const p = await portalProject(principal, params.id);
  if (!p) notFound();

  return (
    <div className="space-y-8">
      <div>
        <Link href="/portal/projects" className="inline-flex items-center gap-1.5 text-[13px] text-ink/55 hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> All projects
        </Link>
        <h1 className="mt-3 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">{p.title}</h1>
        <p className="mt-1.5 text-sm text-ink/55">
          {p.statusText} · {p.services.join(" · ")} · planned to finish {formatDate(p.deadline)}
        </p>
      </div>

      <Card padded={false}>
        <CardHeader title="Progress" description="How much of the planned work is done." />
        <CardBody className="space-y-6">
          <ProgressBar value={p.progress} showValue />
          {p.stages.map((line, i) => (
            <div key={i}>
              {p.stages.length > 1 && <p className="mb-2 text-[12px] font-medium text-ink/55">{line.service ?? "Project"}</p>}
              <ol className="grid gap-2 sm:flex sm:flex-wrap sm:items-center" aria-label={`${line.service ?? "Project"} stages`}>
                {line.stages.map((s, j) => (
                  <li key={j} className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[13px]",
                        s.state === "done" && "border-success/30 bg-success-tint text-success",
                        s.state === "current" && "border-brand/50 bg-brand-tint font-medium text-ink",
                        s.state === "upcoming" && "border-line text-ink/45",
                      )}
                    >
                      {s.state === "done" ? <Check className="h-3.5 w-3.5" /> : s.state === "current" ? <CircleDot className="h-3.5 w-3.5 text-brand" /> : <Circle className="h-3.5 w-3.5" />}
                      {s.name}
                      {s.state === "current" && <span className="sr-only">(current stage)</span>}
                    </span>
                    {j < line.stages.length - 1 && <span className="hidden text-ink/25 sm:inline">→</span>}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card padded={false}>
          <CardHeader title="Coming up" />
          <CardBody>
            {p.upcomingMilestones.length === 0 ? (
              <p className="text-[13px] text-ink/50">Nothing scheduled right now.</p>
            ) : (
              <ul className="divide-y divide-line">
                {p.upcomingMilestones.map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <span className="min-w-0 truncate text-ink">{m.title}</span>
                    <span className="shrink-0 tabular-nums text-ink/55">{m.dueDate ? formatDate(m.dueDate) : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card padded={false}>
          <CardHeader title="Done so far" />
          <CardBody>
            {p.completedMilestones.length === 0 ? (
              <p className="text-[13px] text-ink/50">Milestones appear here as they&apos;re completed.</p>
            ) : (
              <ul className="divide-y divide-line">
                {p.completedMilestones.map((m, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <span className="flex min-w-0 items-center gap-2 text-ink">
                      <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                      <span className="truncate">{m.title}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ink/55">{m.completedAt ? formatDate(m.completedAt) : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card padded={false}>
        <CardHeader title="Updates from your team" />
        <CardBody>
          {p.updates.length === 0 ? (
            <p className="text-[13px] text-ink/50">Your team will post updates here as the project moves.</p>
          ) : (
            <ul className="space-y-5">
              {p.updates.map((u) => (
                <li key={u.id} className="flex gap-3">
                  <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink">{u.title}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink/75">{u.body}</p>
                    <p className="mt-1 text-[11px] text-ink/40">
                      {u.author ?? "Your team"} · {relativeFromNow(u.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader title="Files" description="Files your team has shared with you." />
        <CardBody>
          <FilesPanel owner={{ projectId: p.id }} canUpload={false} canChangeVisibility={false} compact />
        </CardBody>
      </Card>
    </div>
  );
}
