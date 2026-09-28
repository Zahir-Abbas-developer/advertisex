import "server-only";

import { appUrl, isEmailConfigured, sendEmail } from "@/lib/email/send";
import { formatMoney } from "@/modules/billing/money";
import { invoiceDocument, type FullInvoice } from "@/modules/billing/server";
import { pdfFileName, renderInvoicePdf } from "@/modules/billing/pdf";

const escape = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Emails the invoice, PDF attached, to the address it is billed to. Without
 * SMTP it returns false and the invoice is still sent: it is in the client's
 * portal, and the founder can forward the PDF.
 */
export async function emailInvoice(inv: FullInvoice): Promise<boolean> {
  if (!isEmailConfigured()) return false;
  const doc = await invoiceDocument(inv);
  if (!doc.billTo.email) return false;
  const pdf = await renderInvoicePdf(doc);
  const balance = formatMoney(Math.max(0, doc.totalMinor - doc.paidMinor), doc.currency);
  const due = new Date(doc.dueDate).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const link = `${appUrl()}/portal/invoices/${inv.id}`;
  const result = await sendEmail(
    doc.billTo.email,
    {
      subject: `Invoice ${doc.numberLabel} from ${doc.seller.name} — ${balance} due ${due}`,
      text: `Hello ${doc.billTo.name},\n\nPlease find invoice ${doc.numberLabel} attached: ${balance} due by ${due}.\n\nYou can also see it, and your payment history, in your portal:\n${link}\n\nThank you,\n${doc.seller.name}`,
      html: `<p>Hello ${escape(doc.billTo.name)},</p><p>Please find invoice <strong>${escape(doc.numberLabel ?? "")}</strong> attached: <strong>${escape(balance)}</strong> due by ${escape(due)}.</p><p>You can also see it, and your payment history, in <a href="${escape(link)}">your portal</a>.</p><p>Thank you,<br>${escape(doc.seller.name)}</p>`,
    },
    { attachments: [{ filename: pdfFileName(doc, inv.id), content: pdf, contentType: "application/pdf" }] },
  );
  return result.status === "sent";
}
