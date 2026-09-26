import type { Metadata } from "next";

import { requirePage } from "@/modules/rbac/server";
import { ProjectsView } from "@/components/projects/ProjectsView";

export const metadata: Metadata = { title: "Projects" };

/** Every project the viewer may see: the founder all, managers their departments', employees theirs. */
export default async function ProjectsPage() {
  const principal = await requirePage("read", "project");
  return <ProjectsView canCreate={principal.role === "FOUNDER" || principal.role === "MANAGER"} canSeeAnalytics={principal.role === "FOUNDER" || principal.role === "MANAGER"} />;
}
