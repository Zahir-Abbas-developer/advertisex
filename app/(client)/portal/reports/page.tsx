import { ReportsLibrary } from "@/components/portal/ReportsLibrary";
import { requireClientPage } from "@/modules/rbac/server";
import { portalReports } from "@/modules/portal/server";

export const metadata = { title: "Reports · Advertise X" };

export default async function PortalReports() {
  const principal = await requireClientPage();
  const reports = await portalReports(principal);
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow text-brand">Reports</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">Your reports</h1>
        <p className="mt-2 max-w-xl text-sm text-ink-muted">Everything your team has reported on, by month. New ones are marked.</p>
      </header>
      <ReportsLibrary reports={reports} />
    </div>
  );
}
