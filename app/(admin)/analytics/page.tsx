import type { Metadata } from "next";

import { requirePage } from "@/modules/rbac/server";
import { AnalyticsHub } from "@/components/command/AnalyticsHub";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  await requirePage("read", "command");
  return <AnalyticsHub />;
}
