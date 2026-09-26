import type { Metadata } from "next";

import { requirePage } from "@/modules/rbac/server";
import { ProjectsAnalytics } from "@/components/projects/ProjectsAnalytics";

export const metadata: Metadata = { title: "Projects analytics" };

export default async function ProjectsAnalyticsPage() {
  await requirePage("read", "ops");
  return <ProjectsAnalytics />;
}
