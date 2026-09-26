import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/PageHeader";
import { TeamPageTabs } from "@/components/team/TeamPageTabs";
import { authorize } from "@/modules/rbac/authorize";
import { requirePage } from "@/modules/rbac/server";

export const metadata: Metadata = { title: "Team" };

/** The team directory (founder and managers); account management (founder). */
export default async function TeamPage() {
  const principal = await requirePage("read", "ops");
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Team" title="Team" description="The people and AI agents who do the work — their skills, status and roles." />
      <TeamPageTabs currentUserId={principal.id} canManage={authorize(principal, "manage", "admin").allowed} />
    </div>
  );
}
