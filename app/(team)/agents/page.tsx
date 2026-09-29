import type { Metadata } from "next";

import { authorize } from "@/modules/rbac/authorize";
import { requirePage } from "@/modules/rbac/server";
import { AgentsHub } from "@/components/agents/AgentsHub";

export const metadata: Metadata = { title: "AI employees" };

export default async function AgentsPage() {
  const principal = await requirePage("read", "agent");
  return <AgentsHub canHire={authorize(principal, "update", "agent").allowed} canAssign={authorize(principal, "create", "agent").allowed} />;
}
