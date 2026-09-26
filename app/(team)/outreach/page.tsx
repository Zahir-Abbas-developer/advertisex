import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/PageHeader";
import { OutreachView } from "@/components/outreach/OutreachView";
import { requirePage } from "@/modules/rbac/server";

export const metadata: Metadata = { title: "Outreach" };

export default async function OutreachPage() {
  const principal = await requirePage("read", "activity");
  const own = principal.role === "EMPLOYEE";
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="New business"
        title="Outreach"
        description={
          own
            ? "Your calls, emails, meetings and proposals — counted from what you log on each lead."
            : "The team's outreach, person by person and company-wide — counted from what's logged on each lead."
        }
      />
      <OutreachView />
    </div>
  );
}
