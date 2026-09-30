import Link from "next/link";
import { ArrowLeft, CircleAlert, ShieldCheck } from "lucide-react";

import type { RunDetail } from "@/modules/ai/agents/server";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatDateTime } from "@/lib/date";
import { APPROVAL_KIND_LABEL, APPROVAL_STATUS, formatCost, RunStatusBadge, TOOL_LABEL } from "@/components/agents/shared";
import { RunRefresher } from "@/components/agents/RunRefresher";

type Factor = { label: string; points: number; max: number };
const isFactors = (v: unknown): v is Factor[] => Array.isArray(v) && v.every((f) => f && typeof f === "object" && "label" in f && "points" in f && "max" in f);
const LABELS: Record<string, string> = { score: "Score", band: "Band", rationale: "Why", nextStep: "Next step", rationaleBy: "Written by", taskId: "Task", reportId: "Report", sent: "Sent to", signals: "Signals", gaps: "Gaps" };

/** The log of one run: what it was asked, every step it took, what it proposed, what it cost. */
export function RunLog({ run, canDecide }: { run: RunDetail; canDecide: boolean }) {
  const data = run.output?.data ?? {};
  const facts = Object.entries(data).filter(([k, v]) => LABELS[k] && (typeof v === "string" || typeof v === "number" || (Array.isArray(v) && v.every((x) => typeof x === "string"))));
  const factors = isFactors(data.factors) ? data.factors : null;
  const pending = run.approvals.some((a) => a.status === "PENDING");

  return (
    <div className="space-y-6">
      <RunRefresher active={run.status === "QUEUED" || run.status === "RUNNING"} />
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-brand">
        <ArrowLeft className="h-4 w-4" /> AI employees
      </Link>
      <PageHeader
        eyebrow={run.capability}
        title={run.output?.summary ?? `${run.agent.name} · ${run.subject.label}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="inline-flex items-center gap-2">
              <Avatar name={run.agent.name} color={run.agent.avatarColor} size="sm" /> {run.agent.name}
            </span>
            <span>·</span>
            {run.subject.href ? (
              <Link href={run.subject.href} className="text-ink hover:text-brand">
                {run.subject.label}
              </Link>
            ) : (
              <span>{run.subject.label}</span>
            )}
            {run.requestedBy && <span>· asked by {run.requestedBy}</span>}
          </span>
        }
        actions={<RunStatusBadge status={run.status} />}
      />

      {run.status === "FAILED" && run.error && (
        <Card className="flex items-start gap-3">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger-ink" aria-hidden />
          <div>
            <p className="font-medium text-ink">It didn&apos;t finish</p>
            <p className="text-[13px] text-ink-2">{run.error}</p>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <div className="space-y-6">
          {(facts.length > 0 || factors) && (
            <Card padded={false}>
              <CardHeader title="Result" />
              <CardBody>
                <dl className="space-y-3 text-[14px]">
                  {facts.map(([k, v]) => (
                    <div key={k} className="grid gap-1 sm:grid-cols-[120px_minmax(0,1fr)]">
                      <dt className="text-ink-muted">{LABELS[k]}</dt>
                      <dd className="text-ink">{Array.isArray(v) ? (v.length ? v.join(" · ") : "None") : k === "score" ? `${v}/100` : k === "band" ? String(v).charAt(0) + String(v).slice(1).toLowerCase() : k === "rationaleBy" ? (v === "AI" ? "AI" : "Rules (no AI)") : String(v)}</dd>
                    </div>
                  ))}
                </dl>
                {factors && (
                  <ul className="mt-5 grid gap-3 sm:grid-cols-5">
                    {factors.map((f) => (
                      <li key={f.label} className="rounded-lg border border-line bg-surface-2 px-3 py-2.5">
                        <p className="text-[12px] text-ink-muted">{f.label}</p>
                        <p className="font-display text-[18px] font-semibold tabular-nums text-ink">
                          {f.points}
                          <span className="text-[12px] font-normal text-ink-muted">/{f.max}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          )}

          <Card padded={false}>
            <CardHeader title="Steps" description="Every tool it used and every model call, with what went in and what came out." />
            <CardBody>
              {run.steps.length === 0 ? (
                <p className="text-[13px] text-ink-muted">{run.status === "QUEUED" ? "Waiting to start…" : "No steps recorded."}</p>
              ) : (
                <ol className="space-y-2">
                  {run.steps.map((s) => (
                    <li key={s.index} className="rounded-lg border border-line">
                      <details className="group">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-[13px]">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="w-6 shrink-0 text-right tabular-nums text-ink-muted">{s.index + 1}</span>
                            <span className="truncate font-medium text-ink">{TOOL_LABEL[s.tool] ?? s.tool}</span>
                            <code className="hidden truncate text-[12px] text-ink-muted sm:inline">{s.tool}</code>
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            {s.error ? (
                              <Badge tone="danger" size="sm">
                                Failed
                              </Badge>
                            ) : null}
                            <span className="tabular-nums text-[12px] text-ink-muted">{s.durationMs} ms</span>
                          </span>
                        </summary>
                        <div className="space-y-2 border-t border-line px-3 py-3 text-[12px]">
                          <StepJson label="In" value={s.input} />
                          {s.output && <StepJson label="Out" value={s.output} />}
                          {s.error && <p className="text-danger-ink">{s.error}</p>}
                        </div>
                      </details>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          {run.approvals.length > 0 && (
            <Card padded={false}>
              <CardHeader title="Needs a person" description="What it proposed. Nothing happens until someone decides." />
              <CardBody>
                <ul className="space-y-3">
                  {run.approvals.map((a) => {
                    const st = APPROVAL_STATUS[a.status] ?? { label: a.status, tone: "neutral" as const };
                    return (
                      <li key={a.id} className="rounded-lg border border-line px-3 py-2.5 text-[13px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] text-ink-muted">{APPROVAL_KIND_LABEL[a.kind] ?? a.kind}</span>
                          <Badge tone={st.tone} size="sm">
                            {st.label}
                          </Badge>
                        </div>
                        <p className="mt-1 text-ink">{a.summary}</p>
                        {a.decidedBy && <p className="mt-1 text-[12px] text-ink-muted">{`${a.status === "REJECTED" ? "Rejected" : "Approved"} by ${a.decidedBy}${a.note ? ` — “${a.note}”` : ""}`}</p>}
                      </li>
                    );
                  })}
                </ul>
                {pending && canDecide && (
                  <Link href={`/approvals?focus=${run.approvals.find((a) => a.status === "PENDING")!.id}`} className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline">
                    <ShieldCheck className="h-4 w-4" /> Review in Approvals
                  </Link>
                )}
              </CardBody>
            </Card>
          )}

          <Card padded={false}>
            <CardHeader title="Run" />
            <CardBody>
              <dl className="space-y-2.5 text-[13px]">
                <Row label="Queued" value={formatDateTime(run.createdAt)} />
                {run.startedAt && <Row label="Started" value={formatDateTime(run.startedAt)} />}
                {run.finishedAt && <Row label="Finished" value={formatDateTime(run.finishedAt)} />}
                <Row label="Written by" value={run.mode === "AI" ? "AI + rules" : run.mode === "RULES" ? "Rules only" : "—"} />
                {run.usage && (
                  <>
                    <Row label="Tokens" value={`${run.usage.inputTokens.toLocaleString()} in · ${run.usage.outputTokens.toLocaleString()} out`} />
                    <Row label="Cost" value={formatCost(run.usage.costMicros)} />
                  </>
                )}
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right tabular-nums text-ink">{value}</dd>
    </div>
  );
}

function StepJson({ label, value }: { label: string; value: string }) {
  let pretty = value;
  try {
    pretty = JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    /* stored truncated — show as is */
  }
  return (
    <div>
      <p className="mb-1 text-ink-muted">{label}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-surface-2 p-2.5 font-mono text-[12px] leading-relaxed text-ink-2">{pretty}</pre>
    </div>
  );
}
