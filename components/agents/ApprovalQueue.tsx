"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, ShieldCheck, X } from "lucide-react";

import type { ApprovalRow } from "@/modules/ai/agents/server";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";
import { safeFetch } from "@/lib/safe-fetch";
import { ago, APPROVAL_KIND_LABEL, APPROVAL_STATUS } from "@/components/agents/shared";

type View = "PENDING" | "DECIDED";

/**
 * The review queue (Phase 9 scope 2). Agents propose; people decide.
 * Approving carries the action out as you — with your permissions, in your
 * name on the audit log. Founders see everything; managers their departments'
 * (invoices are the founder's alone).
 */
export function ApprovalQueue() {
  const focus = useSearchParams().get("focus");
  const [view, setView] = useState<View>("PENDING");
  const [rows, setRows] = useState<ApprovalRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/approvals?status=${view}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setRows(((await res.json()) as { approvals: ApprovalRow[] }).approvals);
  }, [view]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  useEffect(() => {
    if (focus && rows) document.getElementById(`approval-${focus}`)?.scrollIntoView({ block: "center" });
  }, [focus, rows]);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="AI employees" title="Approvals" description="What agents want to do that reaches a client, closes a deal or bills money. Nothing happens until you decide." />
      <Tabs items={[{ key: "PENDING" as const, label: "Waiting" }, { key: "DECIDED" as const, label: "Decided" }]} active={view} onChange={setView} />
      {failed ? (
        <ErrorState title="Approvals didn't load" onRetry={() => void load()} />
      ) : !rows ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-36 rounded-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card padded={false}>
          <EmptyState icon={ShieldCheck} title={view === "PENDING" ? "Nothing waiting" : "Nothing decided yet"} description={view === "PENDING" ? "When an agent proposes something consequential, it lands here." : "Decisions appear here with who made them."} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} id={`approval-${r.id}`}>
              <ApprovalCard row={r} focused={focus === r.id} onDecided={() => void load()} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ApprovalCard({ row: r, focused, onDecided }: { row: ApprovalRow; focused: boolean; onDecided: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const st = APPROVAL_STATUS[r.status] ?? { label: r.status, tone: "neutral" as const };

  const decide = async (decision: "APPROVED" | "REJECTED") => {
    setBusy(decision);
    setError(null);
    const res = await safeFetch(`/api/approvals/${r.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, note: note.trim() || null }) });
    setBusy(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? "It couldn't be decided");
    toast.success(decision === "APPROVED" ? "Approved — done" : "Rejected");
    onDecided();
  };

  return (
    <Card className={cn("space-y-4", focused && "ring-2 ring-brand/30")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Avatar name={r.agent.name} color={r.agent.avatarColor} />
          <div className="min-w-0">
            <p className="text-[12px] text-ink-muted">
              {r.agent.name} · {APPROVAL_KIND_LABEL[r.kind] ?? r.kind} · {ago(r.createdAt)}
            </p>
            <p className="mt-0.5 font-medium text-ink">{r.summary}</p>
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {r.subject.href ? (
                <Link href={r.subject.href} className="hover:text-brand">
                  {r.subject.label}
                </Link>
              ) : (
                r.subject.label
              )}
              {r.runId && (
                <>
                  {" · "}
                  <Link href={`/agents/runs/${r.runId}`} className="hover:text-brand">
                    See its work
                  </Link>
                </>
              )}
            </p>
          </div>
        </div>
        <Badge tone={st.tone} dot size="sm">
          {st.label}
        </Badge>
      </div>

      <Proposal kind={r.kind} payload={r.payload} />

      {r.status === "PENDING" ? (
        <div className="space-y-3">
          <Textarea label="Note (optional)" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          {error && (
            <p role="alert" className="text-[13px] text-danger-ink">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" icon={<X className="h-4 w-4" />} loading={busy === "REJECTED"} disabled={busy !== null} onClick={() => void decide("REJECTED")}>
              Reject
            </Button>
            <Button size="sm" icon={<Check className="h-4 w-4" />} loading={busy === "APPROVED"} disabled={busy !== null} onClick={() => void decide("APPROVED")}>
              Approve and do it
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-ink-muted">
          {r.decidedBy ? `${r.status === "REJECTED" ? "Rejected" : "Approved"} by ${r.decidedBy}` : "Decided"}
          {r.decidedAt ? ` · ${ago(r.decidedAt)}` : ""}
          {r.note ? ` — “${r.note}”` : ""}
          {r.status === "FAILED" && r.result && typeof r.result.error === "string" ? ` · ${r.result.error}` : ""}
        </p>
      )}
    </Card>
  );
}

/** Exactly what approving would do, in words. */
function Proposal({ kind, payload }: { kind: string; payload: Record<string, unknown> }) {
  const box = "rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px]";
  if (kind === "SEND_CLIENT_MESSAGE") {
    return (
      <div className={box}>
        <p className="mb-1 text-[12px] text-ink-muted">The message, as the client will see it (sent from you)</p>
        <p className="whitespace-pre-wrap text-ink">{String(payload.body ?? "")}</p>
      </div>
    );
  }
  if (kind === "CREATE_INVOICE") {
    const lines = Array.isArray(payload.lines) ? (payload.lines as { description: string; quantity: string; rate: string }[]) : [];
    return (
      <div className={box}>
        <p className="mb-1 text-[12px] text-ink-muted">A draft invoice (you still review and send it) · due in {String(payload.dueInDays ?? 14)} days</p>
        <ul className="space-y-1">
          {lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3 tabular-nums">
              <span className="text-ink">{l.description}</span>
              <span className="text-ink-2">
                {l.quantity} × {l.rate}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (kind === "LEAD_OUTCOME") {
    return <div className={box}>{`Moves the lead to “${String(payload.toStageKey)}”${payload.lostReason ? ` · reason: ${String(payload.lostReason).toLowerCase().replace(/_/g, " ")}` : ""}.`}</div>;
  }
  if (kind === "PUBLISH_REPORT") {
    return <div className={box}>Approves the drafted monthly report and publishes it to the client portal.</div>;
  }
  return null;
}
