import type { Metadata } from "next";

import { requirePage } from "@/modules/rbac/server";
import { InvoiceEditor } from "@/components/billing/InvoiceEditor";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage(props: { searchParams: Promise<{ clientId?: string }> }) {
  const searchParams = await props.searchParams;
  await requirePage("create", "invoice");
  return <InvoiceEditor presetClientId={typeof searchParams.clientId === "string" ? searchParams.clientId : undefined} />;
}
