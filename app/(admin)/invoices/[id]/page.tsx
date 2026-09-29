import type { Metadata } from "next";

import { requirePage } from "@/modules/rbac/server";
import { InvoiceDetail } from "@/components/billing/InvoiceDetail";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requirePage("read", "invoice");
  return <InvoiceDetail id={params.id} />;
}
