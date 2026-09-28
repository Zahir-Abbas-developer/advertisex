import "server-only";

import { prisma } from "@/lib/prisma";
import { balanceOf, isInvoiceStatus, type InvoiceStatus } from "@/modules/billing/domain";

/**
 * Invoices for the client portal (Phase 6 scope 5, filled in Phase 7) —
 * read-only, own account only, never a draft. The portal page and API read
 * through this one function; ownership (OWNER only) is checked by callers.
 */
export type PortalInvoice = {
  id: string;
  number: string;
  issuedAt: string | null;
  dueAt: string;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  currency: string;
  status: InvoiceStatus;
  downloadUrl: string;
};

export async function invoicesForAccount(clientAccountId: string): Promise<PortalInvoice[]> {
  const rows = await prisma.invoice.findMany({
    where: { client: { clientAccountId }, status: { not: "DRAFT" } },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: { id: true, numberLabel: true, issueDate: true, dueDate: true, totalMinor: true, paidMinor: true, currency: true, status: true },
  });
  return rows.map((r) => ({
    id: r.id,
    number: r.numberLabel ?? "",
    issuedAt: r.issueDate?.toISOString() ?? null,
    dueAt: r.dueDate.toISOString(),
    totalMinor: r.totalMinor,
    paidMinor: r.paidMinor,
    balanceMinor: balanceOf(r),
    currency: r.currency,
    status: isInvoiceStatus(r.status) ? r.status : "SENT",
    downloadUrl: `/api/portal/invoices/${r.id}/pdf`,
  }));
}
