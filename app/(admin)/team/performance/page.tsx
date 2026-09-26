import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/PageHeader";
import { TeamPerformance } from "@/components/team/TeamPerformance";
import { requirePage } from "@/modules/rbac/server";

export const metadata: Metadata = { title: "Team performance" };

export default async function TeamPerformancePage() {
  await requirePage("read", "ops");
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Team" title="Team performance" description="How the team is delivering and attending — measured separately, each with its formula one click away." />
      <TeamPerformance />
    </div>
  );
}
