import type { Metadata } from "next";

import { requirePage } from "@/modules/rbac/server";
import { FinanceOverview } from "@/components/billing/FinanceOverview";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage() {
  await requirePage("read", "finance");
  return <FinanceOverview />;
}
