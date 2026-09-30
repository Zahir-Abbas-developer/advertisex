"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Ban, CircleDollarSign, Download, Mail, Pencil, Send, Trash2, Undo2 } from "lucide-react";

import { Button, buttonClasses } from "@/components/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime } from "@/lib/date";
import { safeFetch } from "@/lib/safe-fetch";
import { cn } from "@/lib/utils";
import { PAYMENT_METHOD_LABEL, type PaymentMethod } from "@/modules/billing/domain";
import { formatMoney, formatQuantity } from "@/modules/billing/money";
import type { StaffInvoiceView } from "@/modules/billing/views";
import { InvoiceStatusBadge } from "@/components/billing/shared";
import { ReasonModal, RecordPaymentModal } from "@/components/billing/PaymentModals";

type Dialog = { kind: "pay" } | { kind: "void" } | { kind: "reverse"; paymentId: string; amount: string } | null;

/** One invoice for the founder: its state, what can be done next, and its full money history. */
export function InvoiceDetail({ id }: { id: string }) {
  const router = useRouter();
  const toast = useToast();
  const [inv, setInv] = useState<StaffInvoiceView | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<"send" | "delete" | null>(null);

  const load = useCallback(async () => {
    const res = await safeFetch(`/api/invoices/${id}`, { cache: "no-store" });
    if (!res.ok) return setFailed(true);
    setFailed(false);
    setInv((await res.json()).invoice);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = async () => {
    if (inv?.status === "DRAFT" && !window.confirm("Send this invoice? It takes the next number and can no longer be edited.")) return;
    setBusy("send");
    const res = await safeFetch(`/api/invoices/${id}/send`, { method: "POST" });
    setBusy(null);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return toast.error(body.error ?? "It wasn't sent");
    toast.success(body.issued ? (body.emailed ? `${body.numberLabel} sent and emailed` : `${body.numberLabel} sent — it's in the client's portal (email isn't set up)`) : body.emailed ? "Emailed again" : "Email isn't set up — download the PDF to send it");
    void load();
  };

  const remove = async () => {
    if (!window.confirm("Delete this draft?")) return;
    setBusy("delete");
    const res = await safeFetch(`/api/invoices/${id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) return toast.error("Couldn't delete it");
    router.push("/invoices");
  };

  if (failed) return <ErrorState title="This invoice didn't load" onRetry={() => void load()} />;
  if (!inv) return <Skeleton className="h-96 rounded-card" />;
  const open = ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status);
  const m = (minor: number) => formatMoney(minor, inv.currency);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/invoices" className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink">
          <ArrowLeft className="h-3.5 w-3.5" /> All invoices
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-[28px] font-bold tracking-[-0.02em] text-ink">{inv.numberLabel ?? "Draft invoice"}</h1>
              <InvoiceStatusBadge status={inv.status} size="md" />
            </div>
            <p className="mt-1 text-[14px] text-ink-muted">
              <Link href={`/clients/${inv.client.id}`} className="hover:text-brand">
                {inv.client.businessName}
              </Link>
              {inv.project && (
                <>
                  {" · "}
                  <Link href={`/projects/${inv.project.id}`} className="hover:text-brand">
                    {inv.project.title}
                  </Link>
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {inv.status === "DRAFT" && (
              <>
                <Button variant="ghost" size="sm" icon={<Trash2 className="h-4 w-4" />} loading={busy === "delete"} onClick={() => void remove()}>
                  Delete
                </Button>
                <Link href={`/invoices/${inv.id}/edit`} className={buttonClasses("secondary", "sm")}>
                  <Pencil className="h-4 w-4" /> Edit
                </Link>
              </>
            )}
            <a href={`/api/invoices/${inv.id}/pdf?download=1`} className={buttonClasses("secondary", "sm")}>
              <Download className="h-4 w-4" /> PDF
            </a>
            {open && inv.paidMinor === 0 && (
              <Button variant="ghost" size="sm" icon={<Ban className="h-4 w-4" />} onClick={() => setDialog({ kind: "void" })}>
                Void
              </Button>
            )}
            {inv.status !== "VOID" && inv.status !== "DRAFT" && (
              <Button variant="secondary" size="sm" icon={<Mail className="h-4 w-4" />} loading={busy === "send"} onClick={() => void send()}>
                Email again
              </Button>
            )}
            {inv.status === "DRAFT" && (
              <Button size="sm" icon={<Send className="h-4 w-4" />} loading={busy === "send"} onClick={() => void send()}>
                Send invoice
              </Button>
            )}
            {open && (
              <Button size="sm" icon={<CircleDollarSign className="h-4 w-4" />} onClick={() => setDialog({ kind: "pay" })}>
                Record payment
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {[
          ["Total", m(inv.totalMinor)],
          ["Paid", m(inv.paidMinor)],
          ["Balance due", inv.status === "VOID" || inv.status === "DRAFT" ? "—" : m(inv.balanceMinor)],
          [inv.status === "DRAFT" ? "Due (when sent)" : "Due", formatDate(inv.dueDate)],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-5">
            <p className="eyebrow text-ink-muted">{label}</p>
            <p className={cn("mt-3 truncate font-display text-[19px] font-bold tabular-nums text-ink sm:text-[24px]")}>{value}</p>
          </div>
        ))}
      </div>

      {inv.status === "VOID" && (
        <p className="rounded-card border border-line bg-surface-2 px-5 py-3 text-[13px] text-ink-2">
          Voided {inv.voidedAt ? formatDate(inv.voidedAt) : ""} — {inv.voidReason}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] [&>*]:min-w-0">
        <Card padded={false}>
          <CardHeader title="Lines" description={inv.issueDate ? `Issued ${formatDate(inv.issueDate)}` : "Not issued yet — numbered and dated when sent"} />
          <CardBody className="p-0 sm:p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-surface-2 text-left text-[12px] text-ink-muted">
                  <tr>
                    <th className="px-5 py-2.5 font-medium">Description</th>
                    <th className="px-3 py-2.5 text-right font-medium">Qty</th>
                    <th className="px-3 py-2.5 text-right font-medium">Rate</th>
                    <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {inv.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-5 py-3 text-ink">
                        {l.description}
                        {l.serviceName && l.serviceName !== l.description && <span className="block text-[12px] text-ink-muted">{l.serviceName}</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-2">{formatQuantity(l.quantityMilli)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-ink-2">{m(l.rateMinor)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink">{m(l.amountMinor)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line-strong">
                    <td colSpan={3} className="px-5 py-3 text-right font-medium text-ink">
                      Total
                    </td>
                    <td className="px-5 py-3 text-right font-display text-[16px] font-bold tabular-nums text-ink">{m(inv.totalMinor)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {inv.notes && <p className="whitespace-pre-wrap border-t border-line px-5 py-4 text-[13px] text-ink-2">{inv.notes}</p>}
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card padded={false}>
            <CardHeader title="Billed to" />
            <CardBody className="space-y-1 text-[13px]">
              <p className="text-ink">{inv.billTo.name ?? inv.client.businessName}</p>
              {(inv.billTo.address ?? "").split("\n").filter(Boolean).map((line) => (
                <p key={line} className="text-ink-muted">
                  {line}
                </p>
              ))}
              <p className="text-ink-muted">{inv.billTo.email ?? inv.client.email}</p>
              {inv.status === "DRAFT" && <p className="pt-2 text-[12px] text-ink-muted">Frozen from the client&apos;s details when sent.</p>}
            </CardBody>
          </Card>

          <Card padded={false}>
            <CardHeader title="Payments" />
            <CardBody>
              {inv.payments.length === 0 ? (
                <p className="text-[13px] text-ink-muted">{inv.status === "DRAFT" ? "Payments can be recorded once it's sent." : "No payments yet."}</p>
              ) : (
                <ul className="space-y-3">
                  {inv.payments.map((p) => (
                    <li key={p.id} className={cn("text-[13px]", p.reversedAt && "opacity-60")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("font-medium tabular-nums text-ink", p.reversedAt && "line-through")}>{m(p.amountMinor)}</span>
                        {!p.reversedAt && (
                          <button type="button" onClick={() => setDialog({ kind: "reverse", paymentId: p.id, amount: m(p.amountMinor) })} className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-danger-ink">
                            <Undo2 className="h-3.5 w-3.5" /> Reverse
                          </button>
                        )}
                      </div>
                      <p className="text-ink-muted">
                        {formatDate(p.paidAt)} · {PAYMENT_METHOD_LABEL[p.method as PaymentMethod] ?? p.method}
                        {p.source === "STRIPE" ? " · online" : ""}
                        {p.reference ? ` · ${p.reference}` : ""}
                      </p>
                      {p.recordedBy && <p className="text-[12px] text-ink-muted">Recorded by {p.recordedBy}</p>}
                      {p.reversedAt && (
                        <p className="text-[12px] text-ink-muted">
                          Reversed {formatDateTime(p.reversedAt)}
                          {p.reversedBy ? ` by ${p.reversedBy}` : ""} — {p.reverseReason}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      {dialog?.kind === "pay" && <RecordPaymentModal open onClose={() => setDialog(null)} invoiceId={inv.id} balanceMinor={inv.balanceMinor} currency={inv.currency} onDone={() => void load()} />}
      {dialog?.kind === "void" && (
        <ReasonModal
          open
          onClose={() => setDialog(null)}
          title={`Void ${inv.numberLabel}?`}
          description="It stays on record, keeps its number, and no longer counts as owed. This can't be undone."
          confirm="Void invoice"
          url={`/api/invoices/${inv.id}/void`}
          onDone={() => void load()}
        />
      )}
      {dialog?.kind === "reverse" && (
        <ReasonModal
          open
          onClose={() => setDialog(null)}
          title={`Reverse the ${dialog.amount} payment?`}
          description="For a payment recorded in error or returned. It stays in the history, marked reversed, and the balance goes back up."
          confirm="Reverse payment"
          url={`/api/invoices/${inv.id}/payments/${dialog.paymentId}/reverse`}
          onDone={() => void load()}
        />
      )}
    </div>
  );
}
