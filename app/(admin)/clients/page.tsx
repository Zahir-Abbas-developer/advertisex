import type { Metadata } from "next";

import { prisma } from "@/lib/prisma";
import { requirePage } from "@/modules/rbac/server";
import { ClientsBrowser } from "@/components/clients/ClientsBrowser";

export const metadata: Metadata = {
  title: "Clients",
};

/**
 * The book of business. The founder sees every client and onboards new ones;
 * a manager sees their departments' clients (the API scopes the rows).
 */
export default async function ClientsPage() {
  const principal = await requirePage("read", "client");

  // The catalogue is small and rarely changes, so it ships with the page
  // rather than costing the wizard an extra request when it opens.
  const services = await prisma.serviceCatalog.findMany({
    where: { isActive: true },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      stageTemplates: { select: { name: true }, orderBy: { order: "asc" } },
    },
  });

  return (
    <ClientsBrowser
      canOnboard={principal.role === "FOUNDER"}
      services={services.map((s) => ({ id: s.id, name: s.name, slug: s.slug, description: s.description, stages: s.stageTemplates.map((t) => t.name) }))}
    />
  );
}
