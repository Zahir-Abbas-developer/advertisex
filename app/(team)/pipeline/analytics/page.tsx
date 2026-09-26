import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/PageHeader";
import { LeadsAnalytics } from "@/components/pipeline/LeadsAnalytics";
import { requirePage } from "@/modules/rbac/server";

export const metadata: Metadata = { title: "Leads analytics" };

/** Founder and managers: how the pipeline is performing. Formulas: docs/METRICS.md. */
export default async function LeadsAnalyticsPage() {
  await requirePage("read", "ops");
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Pipeline" title="Leads analytics" description="How leads arrive, move and convert — every number defined in the metrics doc." />
      <LeadsAnalytics />
    </div>
  );
}
