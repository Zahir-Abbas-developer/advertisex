import Link from "next/link";
import { ArrowRight, CalendarClock, FileText, FolderKanban, Megaphone, Sparkles } from "lucide-react";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatDate, relativeFromNow } from "@/lib/date";
import { prisma } from "@/lib/prisma";
import { requireClientPage } from "@/modules/rbac/server";
import { portalOverview } from "@/modules/portal/server";

export const metadata = { title: "Overview · Advertise X" };

/**
 * The client's home (Phase 6 scope 2): what's being done for them, how far
 * along it is, what's coming next and what's new — in plain words. Every
 * number comes from their own account's records (modules/portal/server.ts).
 */
export default async function PortalOverview() {
  const principal = await requireClientPage();
  const [me, data] = await Promise.all([
    prisma.user.findUnique({ where: { id: principal.id }, select: { name: true } }),
    portalOverview(principal),
  ]);
  const first = me?.name.split(" ")[0] ?? "there";
  const onTrack = data.projects.length === 0 ? null : data.projects.every((p) => p.status !== "ON_HOLD");

  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow text-brand">Overview</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink sm:text-[32px]">Hello, {first}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">
          {data.projects.length === 0
            ? "Your team is getting everything ready. Your projects will appear here as soon as work begins."
            : `We're working on ${data.projects.length} project${data.projects.length === 1 ? "" : "s"} for you${onTrack ? ", and everything is moving along." : "."}`}
          {data.unreadReports > 0 && ` There ${data.unreadReports === 1 ? "is a new report" : `are ${data.unreadReports} new reports`} for you.`}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card padded={false}>
            <CardHeader
              title="Your projects"
              action={
                <Link href="/portal/projects" className="text-[13px] text-brand hover:underline">
                  All projects
                </Link>
              }
            />
            <CardBody>
              {data.projects.length === 0 ? (
                <EmptyState icon={FolderKanban} title="Nothing in progress yet" description="Once your team starts, each project's progress and next steps will show here." className="py-6" />
              ) : (
                <ul className="space-y-5">
                  {data.projects.map((p) => (
                    <li key={p.id}>
                      <Link href={`/portal/projects/${p.id}`} className="group block">
                        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-[15px] font-medium text-ink group-hover:text-brand">{p.title}</span>
                          <span className="text-[12px] text-ink-muted">
                            {p.statusText}
                            {p.currentStage ? ` · now: ${p.currentStage}` : ""}
                          </span>
                        </div>
                        <ProgressBar value={p.progress} showValue />
                        <p className="mt-1.5 text-[12px] text-ink-muted">Planned to finish {formatDate(p.deadline)}</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Coming up" description="What's coming next on your projects." />
            <CardBody>
              {data.upcoming.length === 0 ? (
                <p className="text-[13px] text-ink-muted">Nothing scheduled right now.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {data.upcoming.map((u, i) => (
                    <li key={`${u.title}-${i}`} className="flex items-center justify-between gap-3 py-3">
                      <span className="flex min-w-0 items-center gap-3">
                        <CalendarClock className="h-4 w-4 shrink-0 text-ink-muted" />
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] text-ink">{u.title}</span>
                          <Link href={`/portal/projects/${u.project.id}`} className="block truncate text-[12px] text-ink-muted hover:text-brand">
                            {u.project.title}
                          </Link>
                        </span>
                      </span>
                      <span className="shrink-0 text-[12px] tabular-nums text-ink-muted">{formatDate(u.dueDate)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card padded={false}>
            <CardHeader title="What's new" />
            <CardBody>
              {data.activity.length === 0 ? (
                <p className="text-[13px] text-ink-muted">Updates and reports from your team will appear here.</p>
              ) : (
                <ul className="space-y-4">
                  {data.activity.map((a) => (
                    <li key={`${a.kind}-${a.id}`}>
                      <Link href={a.href} className="group flex gap-3">
                        {a.kind === "report" ? <FileText className="mt-0.5 h-4 w-4 shrink-0 text-success-ink" /> : <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-brand" />}
                        <span className="min-w-0">
                          <span className="block text-[13px] text-ink group-hover:text-brand">{a.title}</span>
                          <span className="block text-[12px] text-ink-muted">
                            {a.detail} · {relativeFromNow(a.at)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Your services" />
            <CardBody>
              {data.services.length === 0 ? (
                <p className="text-[13px] text-ink-muted">Your services will be listed here.</p>
              ) : (
                <ul className="space-y-2">
                  {data.services.map((s) => (
                    <li key={s} className="flex items-center gap-2 text-[13px] text-ink/85">
                      <Sparkles className="h-3.5 w-3.5 text-brand" /> {s}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Link href="/portal/messages" className="flex items-center justify-between rounded-card border border-line bg-surface px-5 py-4 text-[13px] text-ink transition-colors hover:border-brand/50">
            Questions? Message your team
            <ArrowRight className="h-4 w-4 text-brand" />
          </Link>
        </div>
      </div>
    </div>
  );
}
