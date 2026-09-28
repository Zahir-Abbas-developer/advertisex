import type { Metadata } from "next";

import { requirePage } from "@/modules/rbac/server";
import { InvoiceDetail } from "@/components/billing/InvoiceDetail";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: { id: string } }) {
  await requirePage("read", "invoice");
  return <InvoiceDetail id={params.id} />;
}
