import "server-only";

import { prisma, transaction } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { isUniqueViolation } from "@/lib/score-service";
import { dateOnlyKey, deriveStatus, numberLabel, paymentBlocker, sendBlocker, voidBlocker, type PaymentMethod } from "@/modules/billing/domain";
import { formatMoney } from "@/modules/billing/money";
import { BillingError, clientOwnerIds, founderIds, keyToDate, todayKey } from "@/modules/billing/server";

/**
 * What happens to an invoice after it is drafted. Every state change is a
 * conditional update (the row must still be in the state we read), so two
 * requests racing can't both succeed; the audit extension records each one.
 */

/**
 * Issues a draft: takes the organization's next number, freezes who it's
 * billed to, dates it today, and marks it SENT. The number comes from an
 * atomic increment inside the same transaction, so numbers are sequential
 * per organization and never reused, and drafts never consume one.
 */
export async function issueInvoice(invoiceId: string) {
  const today = await todayKey();
  return transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { _count: { select: { lines: true } }, client: { select: { businessName: true, contactName: true, email: true, location: true } } },
    });
    if (!inv) throw new BillingError("Not found", 404);
    const blocker = sendBlocker({ status: inv.status, totalMinor: inv.totalMinor, lineCount: inv._count.lines });
    if (blocker) throw new BillingError(blocker, inv.status === "DRAFT" ? 422 : 409);
    if (dateOnlyKey(inv.dueDate) < today) throw new BillingError("The due date has passed — move it to today or later", 422, { dueDate: "Today or later" });

    const org = await tx.organization.update({ where: { id: inv.organizationId }, data: { nextInvoiceNumber: { increment: 1 } }, select: { nextInvoiceNumber: true, invoicePrefix: true } });
    const number = org.nextInvoiceNumber - 1;
    const claimed = await tx.invoice.updateMany({
      where: { id: inv.id, status: "DRAFT" },
      data: {
        status: "SENT",
        number,
        numberLabel: numberLabel(org.invoicePrefix, number),
        issueDate: keyToDate(today),
        sentAt: new Date(),
        billToName: inv.client.businessName,
        billToEmail: inv.client.email,
        billToAddress: [inv.client.contactName, inv.client.location].filter(Boolean).join("\n") || null,
      },
    });
    // Someone else sent it first: rolling back returns the number to the sequence.
    if (claimed.count !== 1) throw new BillingError("This invoice was just sent", 409);
    return tx.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { client: { select: { clientAccountId: true, businessName: true } } } });
  });
}

/** Tells the client's owners in the portal that an invoice is waiting. */
export async function notifyInvoiceSent(inv: { id: string; numberLabel: string | null; totalMinor: number; currency: string; client: { clientAccountId: string | null } }) {
  for (const userId of await clientOwnerIds(inv.client.clientAccountId)) {
    await notify({
      userId,
      type: "INVOICE_SENT",
      title: `New invoice ${inv.numberLabel ?? ""}`.trim(),
      body: `${formatMoney(inv.totalMinor, inv.currency)} — view and download it in your portal.`,
      href: `/portal/invoices/${inv.id}`,
      dedupeKey: `invoice-sent:${inv.id}:${userId}`,
    });
  }
}

export async function voidInvoice(invoiceId: string, reason: string) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true, paidMinor: true } });
  if (!inv) throw new BillingError("Not found", 404);
  const blocker = voidBlocker(inv);
  if (blocker) throw new BillingError(blocker, 409);
  const done = await prisma.invoice.updateMany({
    where: { id: invoiceId, status: inv.status, paidMinor: 0 },
    data: { status: "VOID", voidedAt: new Date(), voidReason: reason },
  });
  if (done.count !== 1) throw new BillingError("The invoice changed — reload and try again", 409);
}

export type PaymentInput = {
  amountMinor: number;
  method: PaymentMethod;
  paidAt: Date;
  reference?: string | null;
  idempotencyKey: string;
  source?: "MANUAL" | "STRIPE";
  providerRef?: string | null;
};

/**
 * Records money received. Idempotent: the same key (per organization)
 * records once — a retry with the same invoice and amount returns the first
 * payment; the same key for anything else is refused. Over-payment is
 * refused. The invoice's paid total and status move in the same
 * transaction, guarded by the paid total we read (optimistic concurrency).
 */
export async function recordPayment(invoiceId: string, organizationId: string, input: PaymentInput, recordedById: string | null) {
  const replay = async () => {
    const existing = await prisma.payment.findUnique({ where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: input.idempotencyKey } } });
    if (!existing) return null;
    if (existing.invoiceId !== invoiceId || existing.amountMinor !== input.amountMinor) {
      throw new BillingError("That request was already used for a different payment", 409);
    }
    return { payment: existing, replayed: true as const };
  };
  const earlier = await replay();
  if (earlier) return earlier;

  const today = await todayKey();
  try {
    const payment = await transaction(async (tx) => {
      const inv = await tx.invoice.findFirst({ where: { id: invoiceId, organizationId } });
      if (!inv) throw new BillingError("Not found", 404);
      const blocker = paymentBlocker(inv, input.amountMinor);
      if (blocker) throw new BillingError(blocker, 422, { amount: blocker });
      const paidMinor = inv.paidMinor + input.amountMinor;
      const status = deriveStatus({ status: inv.status, totalMinor: inv.totalMinor, paidMinor, dueKey: dateOnlyKey(inv.dueDate) }, today);
      const moved = await tx.invoice.updateMany({
        where: { id: inv.id, paidMinor: inv.paidMinor, status: inv.status },
        data: { paidMinor, status, paidAt: status === "PAID" ? input.paidAt : null },
      });
      if (moved.count !== 1) throw new BillingError("Another payment was just recorded — reload and try again", 409);
      return tx.payment.create({
        data: {
          organizationId,
          invoiceId: inv.id,
          amountMinor: input.amountMinor,
          currency: inv.currency,
          method: input.method,
          paidAt: input.paidAt,
          reference: input.reference?.trim() || null,
          idempotencyKey: input.idempotencyKey,
          source: input.source ?? "MANUAL",
          providerRef: input.providerRef ?? null,
          recordedById,
        },
      });
    });
    await notifyPayment(invoiceId, payment.amountMinor, payment.source);
    return { payment, replayed: false as const };
  } catch (error) {
    // Two identical requests at once: the loser's insert hits the unique key
    // and its transaction rolls back whole; answer with the winner's payment.
    if (isUniqueViolation(error)) {
      const winner = await replay();
      if (winner) return winner;
    }
    throw error;
  }
}

async function notifyPayment(invoiceId: string, amountMinor: number, source: string) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, include: { client: { select: { clientAccountId: true, businessName: true } } } });
  if (!inv) return;
  const amount = formatMoney(amountMinor, inv.currency);
  for (const userId of await clientOwnerIds(inv.client.clientAccountId)) {
    await notify({ userId, type: "PAYMENT_RECEIVED", title: `Payment received — thank you`, body: `${amount} towards ${inv.numberLabel}.`, href: `/portal/invoices/${inv.id}` });
  }
  // The founder records manual payments themselves; online ones they hear about.
  if (source !== "MANUAL") {
    for (const userId of await founderIds(inv.organizationId)) {
      await notify({ userId, type: "PAYMENT_RECEIVED", title: `${inv.client.businessName} paid ${amount}`, body: `Online payment towards ${inv.numberLabel}.`, href: `/invoices/${inv.id}` });
    }
  }
}

/** Reverses a payment (kept, with who and why); the invoice's balance and status move back. */
export async function reversePayment(invoiceId: string, paymentId: string, reason: string, reversedById: string) {
  const today = await todayKey();
  await transaction(async (tx) => {
    const p = await tx.payment.findFirst({ where: { id: paymentId, invoiceId } });
    if (!p) throw new BillingError("Not found", 404);
    if (p.reversedAt) throw new BillingError("Already reversed", 409);
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const paidMinor = inv.paidMinor - p.amountMinor;
    const status = deriveStatus({ status: inv.status === "PAID" ? "SENT" : inv.status, totalMinor: inv.totalMinor, paidMinor, dueKey: dateOnlyKey(inv.dueDate) }, today);
    const marked = await tx.payment.updateMany({ where: { id: p.id, reversedAt: null }, data: { reversedAt: new Date(), reversedById, reverseReason: reason } });
    if (marked.count !== 1) throw new BillingError("Already reversed", 409);
    const moved = await tx.invoice.updateMany({ where: { id: inv.id, paidMinor: inv.paidMinor }, data: { paidMinor, status, paidAt: null } });
    if (moved.count !== 1) throw new BillingError("The invoice changed — reload and try again", 409);
  });
}

/**
 * The overdue job (each morning, with the other sweeps): every sent or
 * part-paid invoice whose due date has passed on the company calendar
 * becomes OVERDUE, and the founders and the client's owners are told once.
 * Idempotent: a second run finds nothing to move and notifies no one.
 */
export async function sweepInvoices(now = new Date()) {
  const today = await todayKey(now);
  const due = await prisma.invoice.findMany({
    where: { status: { in: ["SENT", "PARTIALLY_PAID"] }, dueDate: { lt: keyToDate(today) } },
    include: { client: { select: { businessName: true, clientAccountId: true } } },
  });
  let moved = 0;
  let notified = 0;
  for (const inv of due) {
    const status = deriveStatus({ status: inv.status, totalMinor: inv.totalMinor, paidMinor: inv.paidMinor, dueKey: dateOnlyKey(inv.dueDate) }, today);
    if (status !== "OVERDUE") continue;
    const done = await prisma.invoice.updateMany({ where: { id: inv.id, status: inv.status, paidMinor: inv.paidMinor }, data: { status: "OVERDUE" } });
    if (done.count !== 1) continue;
    moved += 1;
    const stamp = await prisma.invoice.updateMany({ where: { id: inv.id, overdueNotifiedAt: null }, data: { overdueNotifiedAt: now } });
    if (stamp.count !== 1) continue;
    const balance = formatMoney(inv.totalMinor - inv.paidMinor, inv.currency);
    for (const userId of await founderIds(inv.organizationId)) {
      await notify({ userId, type: "INVOICE_OVERDUE", title: `${inv.client.businessName}: ${inv.numberLabel} is overdue`, body: `${balance} was due ${dateOnlyKey(inv.dueDate)}.`, href: `/invoices/${inv.id}`, dedupeKey: `invoice-overdue:${inv.id}:${userId}` });
      notified += 1;
    }
    for (const userId of await clientOwnerIds(inv.client.clientAccountId)) {
      await notify({ userId, type: "INVOICE_OVERDUE", title: `Invoice ${inv.numberLabel} is past due`, body: `${balance} was due ${dateOnlyKey(inv.dueDate)}. Please arrange payment.`, href: `/portal/invoices/${inv.id}`, dedupeKey: `invoice-overdue:${inv.id}:${userId}` });
      notified += 1;
    }
  }
  return { checked: due.length, moved, notified };
}
