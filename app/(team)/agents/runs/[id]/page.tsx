import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requirePage } from "@/modules/rbac/server";
import { runDetail } from "@/modules/ai/agents/server";
import { RunLog } from "@/components/agents/RunLog";

export const metadata: Metadata = { title: "Agent run" };
export const dynamic = "force-dynamic";

/** One run, step by step. Outside the viewer's scope it doesn't exist. */
export default async function AgentRunPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const principal = await requirePage("read", "agent");
  const run = await runDetail(principal, params.id);
  if (!run) notFound();
  return <RunLog run={run} canDecide={principal.role === "FOUNDER" || principal.role === "MANAGER"} />;
}
