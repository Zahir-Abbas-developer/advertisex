"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { MonthlyReportView } from "@/components/reports/MonthlyReportView";
import type { ReportData } from "@/modules/monthly-reports/domain";

type Loaded = { id: string; title: string; status: string; reviewState: string; summary: string | null; summarySource: string | null; data: ReportData | null };
const SOURCE_LABEL: Record<string, string> = { AI: "Written by AI from the facts below", TEMPLATE: "Written from the facts below", EDITED: "Edited by your team" };

/**
 * The human review of a generated report (Phase 8 scope 4): read it exactly as
 * the client will, edit the summary, then approve — which publishes it and
 * tells the client.
 */
export function ReportReviewModal({ clientId, reportId, onClose, onChanged }: { clientId: string; reportId: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [report, setReport] = useState<Loaded | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<"save" | "approve" | null>(null);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/clients/${clientId}/reports/${reportId}`, { cache: "no-store" });
    if (!res.ok) return toast.error("That report didn't load");
    const body = await res.json();
    setReport(body.report);
    setCanReview(body.canReview);
    setSummary(body.report.summary ?? "");
  }, [clientId, reportId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: "revise" | "approve") => {
    if (action === "approve" && !window.confirm("Publish this report to the client? They'll be notified.")) return;
    setBusy(action === "revise" ? "save" : "approve");
    const res = await safeFetch(`/api/clients/${clientId}/reports/${reportId}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "revise" ? { action, summary } : { action }) });
    setBusy(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.fields?.summary);
      return toast.error(body.error ?? "That didn't work");
    }
    setError(undefined);
    onChanged();
    if (action === "approve") {
      toast.success("Published — the client has been told");
      onClose();
    } else {
      toast.success("Summary saved and the PDF updated");
      void load();
    }
  };

  const dirty = report ? summary.trim() !== (report.summary ?? "").trim() : false;

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy !== null}
      size="lg"
      title={report?.title ?? "Report"}
      eyebrow="Review before publishing"
      footer={
        canReview && report?.status !== "PUBLISHED" ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy !== null}>
              Close
            </Button>
            <Button variant="secondary" loading={busy === "save"} disabled={!dirty || busy !== null} onClick={() => void act("revise")}>
              Save summary
            </Button>
            <Button loading={busy === "approve"} disabled={dirty || busy !== null} onClick={() => void act("approve")}>
              Approve and publish
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {!report || !report.data ? (
        <Skeleton className="h-64 rounded-card" />
      ) : (
        <div className="space-y-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-medium text-ink">Summary</p>
              {report.summarySource && (
                <Badge size="sm" tone={report.summarySource === "AI" ? "info" : "neutral"}>
                  {report.summarySource === "AI" && <Sparkles className="h-3 w-3" />} {SOURCE_LABEL[report.summarySource] ?? report.summarySource}
                </Badge>
              )}
            </div>
            <Textarea aria-label="Summary" rows={6} value={summary} onChange={(e) => setSummary(e.target.value)} error={error} disabled={!canReview || report.status === "PUBLISHED"} />
            {dirty && <p className="text-[12px] text-ink-muted">Save your edit before approving — the PDF is re-rendered with it.</p>}
          </div>
          <div className="rounded-card border border-line bg-canvas p-4">
            <MonthlyReportView data={report.data} summary={summary || report.summary || ""} />
          </div>
        </div>
      )}
    </Modal>
  );
}
