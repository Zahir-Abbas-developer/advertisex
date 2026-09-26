import type { Metadata } from "next";

import { ServicesCatalogManager } from "@/components/settings/ServicesCatalogManager";

export const metadata: Metadata = { title: "Services" };

/** The service catalog: prices, cadences, stage templates, required skills. Founder-only (settings layout). */
export default function ServicesSettingsPage() {
  return <ServicesCatalogManager />;
}
