import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePage } from "@/modules/rbac/server";
import { ProjectDetail } from "@/components/projects/ProjectDetail";

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { title: true } });
  return { title: project?.title ?? "Project" };
}

/** One project. Access is checked by its API; a project out of scope reads as missing. */
export default async function ProjectPage({ params }: { params: { id: string } }) {
  const principal = await requirePage("read", "project");
  return <ProjectDetail projectId={params.id} viewerId={principal.id} />;
}
