import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePage } from "@/modules/rbac/server";
import { ProjectDetail } from "@/components/projects/ProjectDetail";

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const project = await prisma.project.findUnique({ where: { id: params.id }, select: { title: true } });
  return { title: project?.title ?? "Project" };
}

/** One project. Access is checked by its API; a project out of scope reads as missing. */
export default async function ProjectPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const principal = await requirePage("read", "project");
  return <ProjectDetail projectId={params.id} viewerId={principal.id} />;
}
