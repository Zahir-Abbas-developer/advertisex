import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import type { ReportData } from "@/modules/monthly-reports/domain";

/**
 * The in-app monthly report — the same content as the PDF, from the same
 * frozen snapshot. Used by the client's portal page and the team's review.
 * Positive changes are brand green; lower figures are gray, never red.
 */
export function MonthlyReportView({ data, summary }: { data: ReportData; summary: string }) {
  return (
    <article className="space-y-8">
      <header className="surface-dark overflow-hidden rounded-card border border-line-strong">
        <div className="relative px-6 py-8 sm:px-9">
          <p className="eyebrow text-ink-muted">Monthly report</p>
          <h2 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">{data.clientName}</h2>
          <p className="mt-1 text-[14px] text-ink-2">{data.monthLabel}</p>
        </div>
      </header>

      <section className="rounded-card border border-line bg-green-50 px-6 py-5">
        <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">{summary}</p>
      </section>

      {data.demoData && (
        <p className="flex items-center gap-2 text-[12px] text-ink-muted">
          <Info className="h-3.5 w-3.5 text-info" /> Includes demonstration figures, not live account data.
        </p>
      )}

      {data.highlights.length > 0 && (
        <section>
          <h3 className="font-display text-lg font-bold text-ink-heading">Highlights</h3>
          <ul className="mt-3 space-y-2">
            {data.highlights.map((h) => (
              <li key={h} className="flex gap-2.5 text-[14px] text-ink">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-data-1" aria-hidden />
                {h}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.channels.map((c) => (
        <section key={c.channel}>
          <h3 className="font-display text-lg font-bold text-ink-heading">{c.label}</h3>
          <p className="text-[13px] text-ink-muted">{c.question}</p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {c.metrics
              .filter((m) => m.value !== null)
              .map((m) => (
                <div key={m.key} className="rounded-[10px] border border-line bg-surface px-4 py-3">
                  <p className="text-[12px] text-ink-muted">{m.label}</p>
                  <p className="mt-1 font-display text-[20px] font-bold tabular-nums text-ink">{m.display}</p>
                  {m.good !== null && <p className={cn("text-[11px] font-medium", m.good ? "text-success-ink" : "text-data-negative")}>{(m.change ?? 0) > 0 ? "Up" : "Down"} on last month</p>}
                </div>
              ))}
          </div>
        </section>
      ))}

      {data.projects.length > 0 && (
        <section>
          <h3 className="font-display text-lg font-bold text-ink-heading">Your projects</h3>
          <ul className="mt-3 space-y-4">
            {data.projects.map((p) => (
              <li key={p.title} className="rounded-card border border-line bg-surface px-5 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-[15px] font-medium text-ink">{p.title}</p>
                  <p className="text-[13px] tabular-nums text-ink-2">
                    {p.progress}% · {p.statusText}
                  </p>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-pill bg-data-track">
                  <div className="h-full rounded-pill bg-data-1" style={{ width: `${Math.max(0, Math.min(100, p.progress))}%` }} />
                </div>
                {p.currentStage && <p className="mt-2 text-[13px] text-ink-2">Now: {p.currentStage}</p>}
                {p.doneThisMonth.length > 0 && <p className="mt-1 text-[13px] text-ink-2">Done this month: {p.doneThisMonth.join(", ")}</p>}
                {p.nextUp.length > 0 && <p className="mt-1 text-[13px] text-ink-muted">Next: {p.nextUp.map((n) => n.title).join(", ")}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
