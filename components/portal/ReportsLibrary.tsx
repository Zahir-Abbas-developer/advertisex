"use client";

import { useState } from "react";
import { Download, Eye, FileBarChart } from "lucide-react";

import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";
import { formatBytes, cn } from "@/lib/utils";
import { groupReports, REPORT_KIND_LABEL } from "@/modules/portal/views";

type Report = { id: string; title: string; kind: string; periodMonth: string; publishedAt: string | null; mimeType: string; size: number; unread: boolean };

/**
 * The client's reports, by month, newest first (Phase 6 scope 4). Opening or
 * downloading marks a report read; links are signed and short-lived.
 */
export function ReportsLibrary({ reports: initial }: { reports: Report[] }) {
  const toast = useToast();
  const [reports, setReports] = useState(initial);

  const open = async (r: Report, disposition: "inline" | "attachment") => {
    // Open the tab first so browsers don't block it, then point it at the signed link.
    const tab = disposition === "inline" ? window.open("about:blank", "_blank") : null;
    const res = await safeFetch(`/api/portal/reports/${r.id}/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disposition }) });
    if (!res.ok) {
      tab?.close();
      return toast.error("That report couldn't be opened — please try again");
    }
    const { url } = await res.json();
    if (tab) tab.location.href = url;
    else window.location.href = url;
    setReports((rs) => rs.map((x) => (x.id === r.id ? { ...x, unread: false } : x)));
  };

  if (reports.length === 0) {
    return (
      <Card padded={false}>
        <EmptyState icon={FileBarChart} title="No reports yet" description="Your reports will be shared here as soon as they're ready — we'll let you know." />
      </Card>
    );
  }
  return (
    <div className="space-y-6">
      {groupReports(reports).map((g) => (
        <Card key={g.month} padded={false}>
          <CardHeader title={g.label} />
          <CardBody className="p-0 sm:p-0">
            <ul className="divide-y divide-line">
              {g.reports.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", r.unread ? "bg-brand" : "bg-transparent")} aria-label={r.unread ? "New" : undefined} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("truncate text-[14px]", r.unread ? "font-semibold text-ink" : "text-ink/85")}>{r.title}</p>
                    <p className="text-[12px] text-ink-muted">
                      {REPORT_KIND_LABEL[r.kind as keyof typeof REPORT_KIND_LABEL] ?? "Report"} · {formatBytes(r.size)}
                      {r.unread ? " · new" : ""}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {(r.mimeType === "application/pdf" || r.mimeType.startsWith("image/")) && (
                      <button type="button" onClick={() => void open(r, "inline")} className="flex items-center gap-1.5 rounded-pill border border-line px-3 py-1.5 text-[13px] text-ink/80 hover:border-ink/25 hover:text-ink">
                        <Eye className="h-3.5 w-3.5" /> Open
                      </button>
                    )}
                    <button type="button" onClick={() => void open(r, "attachment")} className="flex items-center gap-1.5 rounded-pill border border-line px-3 py-1.5 text-[13px] text-ink/80 hover:border-ink/25 hover:text-ink">
                      <Download className="h-3.5 w-3.5" /> Download
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
