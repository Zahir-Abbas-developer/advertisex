import Link from "next/link";
import { FolderKanban } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatDate } from "@/lib/date";
import { requireClientPage } from "@/modules/rbac/server";
import { portalProjects } from "@/modules/portal/server";

export const metadata = { title: "Projects · Advertise X" };

/** The client's projects — current first, then finished ones. */
export default async function PortalProjects() {
  const principal = await requireClientPage();
  const projects = await portalProjects(principal);
  const current = projects.filter((p) => p.open);
  const done = projects.filter((p) => !p.open);

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow text-brand">Projects</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">Your projects</h1>
      </header>
      {projects.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={FolderKanban} title="No projects yet" description="When your team starts work, each project appears here with its progress." />
        </Card>
      ) : (
        <>
          <Section title="In progress" projects={current} empty="Nothing in progress right now." />
          {done.length > 0 && <Section title="Finished" projects={done} empty="" />}
        </>
      )}
    </div>
  );
}

function Section({ title, projects, empty }: { title: string; projects: Awaited<ReturnType<typeof portalProjects>>; empty: string }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[13px] font-medium text-ink/60">{title}</h2>
      {projects.length === 0 ? (
        <p className="text-[13px] text-ink/45">{empty}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} href={`/portal/projects/${p.id}`} className="group min-w-0 rounded-card border border-line bg-surface p-5 transition-colors hover:border-ink/20">
              <div className="flex items-start justify-between gap-3">
                <h3 className="truncate text-[15px] font-semibold text-ink group-hover:text-brand">{p.title}</h3>
                <span className="shrink-0 text-[12px] text-ink/50">{p.statusText}</span>
              </div>
              <p className="mt-1 truncate text-[12px] text-ink/45">{p.services.join(" · ")}</p>
              <div className="mt-4">
                <ProgressBar value={p.progress} showValue size="sm" />
              </div>
              <p className="mt-2 text-[12px] text-ink/45">
                {p.currentStage ? `Now: ${p.currentStage} · ` : ""}
                {p.open ? `planned to finish ${formatDate(p.deadline)}` : `finished`}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
