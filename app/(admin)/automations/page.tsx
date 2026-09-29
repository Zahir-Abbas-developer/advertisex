import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePage } from "@/modules/rbac/server";
import { AutomationsManager } from "@/components/agents/AutomationsManager";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL } from "@/lib/pipeline-types";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const principal = await requirePage("read", "automation");
  const departments = await prisma.department.findMany({ where: { organizationId: principal.organizationId ?? "__none__", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  return <AutomationsManager departments={departments} sources={LEAD_SOURCES.map((s) => ({ value: s, label: LEAD_SOURCE_LABEL[s] }))} />;
}
