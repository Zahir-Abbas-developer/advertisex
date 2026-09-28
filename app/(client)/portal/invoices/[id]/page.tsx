import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";

import { buttonClasses } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { InvoiceStatusBadge } from "@/components/billing/shared";
import { PayOnlineButton } from "@/components/portal/PayOnlineButton";
import { formatDate } from "@/lib/date";
import { requireClientPage } from "@/modules/rbac/server";
import { invoiceForClient } from "@/modules/billing/server";
import { portalInvoiceView } from "@/modules/billing/views";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/modules/billing/domain";
import { formatMoney, formatQuantity } from "@/modules/billing/money";
import { onlinePaymentsEnabled } from "@/modules/integrations/payments";

export const metadata = { title: "Invoice · Advertise X" };

/**
 * One invoice for the client: what it's for, what's been paid, what's left,
 * and the PDF. Built from the allow-listed portal view. Another account's
 * invoice, a draft, or a member (not the owner) asking: not found.
 */
export default async function PortalInvoice({ params, searchParams }: { params: { id: string }; searchParams: { paid?: string } }) {
  const principal = await requireClientPage();
  const found = await invoiceForClient(principal, params.id);
  if (!found) notFound();
  const inv = portalInvoiceView(found);
  const m = (minor: number) => formatMoney(minor, inv.currency);
  const payable = ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status) && inv.balanceMinor > 0;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/portal/invoices" className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> All invoices
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">Invoice {inv.numberLabel}</h1>
              <InvoiceStatusBadge status={inv.status} size="md" />
            </div>
            <p className="mt-1 text-[14px] text-ink-muted">
              {inv.issueDate ? `Issued ${formatDate(inv.issueDate)} · ` : ""}due {formatDate(inv.dueDate)}
              {inv.project ? ` · ${inv.project.title}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`/api/portal/invoices/${inv.id}/pdf?download=1`} className={buttonClasses("secondary", "md")}>
              <Download className="h-4 w-4" /> Download PDF
            </a>
            {payable && onlinePaymentsEnabled() && <PayOnlineButton invoiceId={inv.id} label={`Pay ${m(inv.balanceMinor)}`} />}
          </div>
        </div>
      </div>

      {searchParams.paid && inv.status !== "PAID" && (
        <p className="rounded-card border border-line bg-surface-2 px-5 py-3 text-[13px] text-ink-2">Thank you — your payment is being confirmed and will appear here shortly.</p>
      )}

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        {[
          ["Total", m(inv.totalMinor)],
          ["Paid", m(inv.paidMinor)],
          [inv.status === "VOID" ? "Cancelled" : "Left to pay", inv.status === "VOID" ? "—" : m(inv.balanceMinor)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-5">
            <p className="eyebrow truncate text-ink-muted">{label}</p>
            <p className="mt-3 truncate font-display text-[17px] font-bold tabular-nums text-ink sm:text-[24px]">{value}</p>
          </div>
        ))}
      </div>

      <Card padded={false}>
        <CardHeader title="What it's for" />
        <CardBody className="p-0 sm:p-0">
          <ul className="divide-y divide-line">
            {inv.lines.map((l, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3.5 text-[13px] sm:px-6">
                <span className="min-w-0 flex-1 text-ink">{l.description}</span>
                <span className="tabular-nums text-ink-muted">
                  {formatQuantity(l.quantityMilli)} × {m(l.rateMinor)}
                </span>
                <span className="w-28 text-right tabular-nums text-ink">{m(l.amountMinor)}</span>
              </li>
            ))}
          </ul>
          {inv.notes && <p className="whitespace-pre-wrap border-t border-line px-5 py-4 text-[13px] text-ink-2 sm:px-6">{inv.notes}</p>}
        </CardBody>
      </Card>

      <Card padded={false}>
        <CardHeader title="Payments" />
        <CardBody>
          {inv.payments.length === 0 ? (
            <p className="text-[13px] text-ink-muted">No payments yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {inv.payments.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[13px]">
                  <span className="text-ink-2">
                    {formatDate(p.paidAt)} · {PAYMENT_METHOD_LABEL[p.method as PaymentMethod] ?? "Payment"}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                  <span className="tabular-nums text-ink">{m(p.amountMinor)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
