/**
 * What leaves the server about an invoice. Both views copy named fields into
 * new objects (allow-lists, as in modules/portal/views.ts): the portal view
 * omits who recorded or reversed payments, reversed payments themselves,
 * void reasons, and internal ids beyond the invoice's own.
 */

import { balanceOf, isInvoiceStatus, type InvoiceStatus } from "@/modules/billing/domain";

type Line = { id: string; serviceId: string | null; description: string; quantityMilli: number; rateMinor: number; amountMinor: number; service?: { id: string; name: string } | null };
type Pay = {
  id: string;
  amountMinor: number;
  method: string;
  paidAt: Date;
  reference: string | null;
  source: string;
  reversedAt: Date | null;
  reverseReason: string | null;
  recordedBy?: { name: string } | null;
  reversedBy?: { name: string } | null;
};
export type InvoiceSource = {
  id: string;
  numberLabel: string | null;
  status: string;
  currency: string;
  issueDate: Date | null;
  dueDate: Date;
  notes: string | null;
  subtotalMinor: number;
  totalMinor: number;
  paidMinor: number;
  billToName: string | null;
  billToEmail: string | null;
  billToAddress: string | null;
  sentAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  client: { id: string; businessName: string; email: string };
  project: { id: string; title: string } | null;
  lines: Line[];
  payments: Pay[];
  createdBy?: { name: string } | null;
};

const iso = (d: Date | null) => d?.toISOString() ?? null;
const status = (s: string): InvoiceStatus => (isInvoiceStatus(s) ? s : "SENT");

export function staffInvoiceView(inv: InvoiceSource) {
  return {
    id: inv.id,
    numberLabel: inv.numberLabel,
    status: status(inv.status),
    currency: inv.currency,
    issueDate: iso(inv.issueDate),
    dueDate: inv.dueDate.toISOString(),
    notes: inv.notes,
    subtotalMinor: inv.subtotalMinor,
    totalMinor: inv.totalMinor,
    paidMinor: inv.paidMinor,
    balanceMinor: balanceOf(inv),
    billTo: { name: inv.billToName, email: inv.billToEmail, address: inv.billToAddress },
    sentAt: iso(inv.sentAt),
    paidAt: iso(inv.paidAt),
    voidedAt: iso(inv.voidedAt),
    voidReason: inv.voidReason,
    createdAt: inv.createdAt.toISOString(),
    createdBy: inv.createdBy?.name ?? null,
    client: { id: inv.client.id, businessName: inv.client.businessName, email: inv.client.email },
    project: inv.project ? { id: inv.project.id, title: inv.project.title } : null,
    lines: inv.lines.map((l) => ({
      id: l.id,
      serviceId: l.serviceId,
      serviceName: l.service?.name ?? null,
      description: l.description,
      quantityMilli: l.quantityMilli,
      rateMinor: l.rateMinor,
      amountMinor: l.amountMinor,
    })),
    payments: inv.payments.map((p) => ({
      id: p.id,
      amountMinor: p.amountMinor,
      method: p.method,
      paidAt: p.paidAt.toISOString(),
      reference: p.reference,
      source: p.source,
      recordedBy: p.recordedBy?.name ?? null,
      reversedAt: iso(p.reversedAt),
      reversedBy: p.reversedBy?.name ?? null,
      reverseReason: p.reverseReason,
    })),
  };
}
export type StaffInvoiceView = ReturnType<typeof staffInvoiceView>;

/** The client's view: its invoice, its lines, the money it has paid. */
export function portalInvoiceView(inv: InvoiceSource) {
  return {
    id: inv.id,
    numberLabel: inv.numberLabel ?? "",
    status: status(inv.status),
    currency: inv.currency,
    issueDate: iso(inv.issueDate),
    dueDate: inv.dueDate.toISOString(),
    notes: inv.notes,
    totalMinor: inv.totalMinor,
    paidMinor: inv.paidMinor,
    balanceMinor: balanceOf(inv),
    billTo: { name: inv.billToName ?? inv.client.businessName },
    project: inv.project ? { title: inv.project.title } : null,
    lines: inv.lines.map((l) => ({ description: l.description, quantityMilli: l.quantityMilli, rateMinor: l.rateMinor, amountMinor: l.amountMinor })),
    payments: inv.payments.filter((p) => !p.reversedAt).map((p) => ({ amountMinor: p.amountMinor, method: p.method, paidAt: p.paidAt.toISOString(), reference: p.reference })),
  };
}
export type PortalInvoiceView = ReturnType<typeof portalInvoiceView>;
