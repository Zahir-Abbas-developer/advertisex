import type { Metadata } from "next";
import { Suspense } from "react";

import { requirePage } from "@/modules/rbac/server";
import { ApprovalQueue } from "@/components/agents/ApprovalQueue";

export const metadata: Metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  await requirePage("read", "approval");
  return (
    <Suspense>
      <ApprovalQueue />
    </Suspense>
  );
}
