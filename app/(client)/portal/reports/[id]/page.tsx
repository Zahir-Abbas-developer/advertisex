import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { MonthlyReportView } from "@/components/reports/MonthlyReportView";
import { ReportDownloadButton } from "@/components/portal/ReportDownloadButton";
import { requireClientPage } from "@/modules/rbac/server";
import { portalReportView } from "@/modules/portal/server";

export const metadata = { title: "Report · Advertise X" };

/** A monthly report, read in the portal (the PDF has the same content). */
export default async function PortalReport(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const principal = await requireClientPage();
  const report = await portalReportView(principal, params.id);
  if (!report) notFound();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/portal/reports" className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> All reports
        </Link>
        <ReportDownloadButton reportId={report.id} />
      </div>
      <MonthlyReportView data={report.data} summary={report.summary} />
    </div>
  );
}
