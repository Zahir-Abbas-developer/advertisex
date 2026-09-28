import type { Metadata } from "next";

import { requirePage } from "@/modules/rbac/server";
import { InvoicesList } from "@/components/billing/InvoicesList";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage() {
  await requirePage("read", "invoice");
  return <InvoicesList />;
}
