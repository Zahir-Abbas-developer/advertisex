import type { Metadata } from "next";

import { requirePage } from "@/modules/rbac/server";
import { InvoiceEditor } from "@/components/billing/InvoiceEditor";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: { clientId?: string } }) {
  await requirePage("create", "invoice");
  return <InvoiceEditor presetClientId={typeof searchParams.clientId === "string" ? searchParams.clientId : undefined} />;
}
