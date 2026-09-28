import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { requirePage } from "@/modules/rbac/server";
import { invoiceForStaff } from "@/modules/billing/server";
import { dateOnlyKey } from "@/modules/billing/domain";
import { formatQuantity, toDecimalString } from "@/modules/billing/money";
import { InvoiceEditor } from "@/components/billing/InvoiceEditor";

export const metadata: Metadata = { title: "Edit invoice" };

/** Only a draft is edited; a sent invoice opens its detail instead. */
export default async function EditInvoicePage({ params }: { params: { id: string } }) {
  const principal = await requirePage("update", "invoice");
  const inv = await invoiceForStaff(principal, params.id, "update");
  if (!inv) notFound();
  if (inv.status !== "DRAFT") redirect(`/invoices/${inv.id}`);
  return (
    <InvoiceEditor
      initial={{
        id: inv.id,
        clientId: inv.clientId,
        projectId: inv.projectId,
        currency: inv.currency,
        dueDate: dateOnlyKey(inv.dueDate),
        notes: inv.notes,
        lines: inv.lines.map((l) => ({ serviceId: l.serviceId, description: l.description, quantity: formatQuantity(l.quantityMilli), rate: toDecimalString(l.rateMinor) })),
      }}
    />
  );
}
