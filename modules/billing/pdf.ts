import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { formatMoney, formatQuantity } from "@/modules/billing/money";
import { INVOICE_STATUS_LABEL, PAYMENT_METHOD_LABEL, type InvoiceStatus, type PaymentMethod } from "@/modules/billing/domain";

/**
 * The invoice as a branded PDF (Forest & Mint, print-friendly: a deep
 * green header band with the brand mark, then a white page). Built with pdf-lib and
 * the standard Helvetica faces, so there is nothing to install on a server
 * and no font files to ship. Deterministic from the invoice's data.
 */

export type InvoiceDocument = {
  seller: { name: string; address: string | null; email: string | null };
  numberLabel: string | null;
  status: InvoiceStatus;
  issueDate: string | null;
  dueDate: string;
  currency: string;
  billTo: { name: string; email: string | null; address: string | null };
  project: string | null;
  lines: { description: string; quantityMilli: number; rateMinor: number; amountMinor: number }[];
  subtotalMinor: number;
  totalMinor: number;
  paidMinor: number;
  notes: string | null;
  payments: { paidAt: string; method: string; reference: string | null; amountMinor: number }[];
};

// Forest & Mint (CLAUDE.md §7) — the palette's exact values.
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const GREEN_950 = hex("#022313");
const BRAND = hex("#0E5B37");
const GREEN_600 = hex("#279D61");
const GREEN_100 = hex("#CEE4D9");
const GREEN_50 = hex("#E7F4EB");
const INK = GREEN_950;
const MUTED = hex("#656565");
const GRAY_300 = hex("#CBCBCD");
const WHITE = hex("#FFFFFF");
const DANGER = hex("#DC2626");

const W = 612;
const H = 792;
const M = 48;

const dateText = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

export async function renderInvoicePdf(doc: InvoiceDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${doc.numberLabel ?? "draft"} — ${doc.seller.name}`);
  pdf.setAuthor(doc.seller.name);
  pdf.setCreator("Advertise X");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  /** Only characters the font can encode; anything else becomes "?". */
  const safe = (text: string, font: PDFFont = regular) =>
    [...text.replace(/\r/g, "")].map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    }).join("");
  const money = (minor: number) => {
    const s = formatMoney(minor, doc.currency);
    return safe(s) === s ? s : `${doc.currency} ${formatMoney(minor, "USD").replace("$", "")}`;
  };
  const text = (page: PDFPage, value: string, x: number, y: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(safe(value, o.font ?? regular), { x, y, font: o.font ?? regular, size: o.size ?? 9.5, color: o.color ?? INK });
  const right = (page: PDFPage, value: string, xRight: number, y: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const font = o.font ?? regular;
    const v = safe(value, font);
    text(page, v, xRight - font.widthOfTextAtSize(v, o.size ?? 9.5), y, o);
  };
  const wrap = (value: string, width: number, font = regular, size = 9.5): string[] => {
    const out: string[] = [];
    for (const para of value.split("\n").map((p) => safe(p, font))) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
        else {
          out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  };

  const header = (page: PDFPage, compact: boolean) => {
    const band = compact ? 64 : 112;
    page.drawRectangle({ x: 0, y: H - band, width: W, height: band, color: GREEN_950 });
    page.drawRectangle({ x: 0, y: H - band - 2, width: W, height: 2, color: GREEN_600 });
    const top = H - (compact ? 40 : 56);
    page.drawRectangle({ x: M, y: top - 6, width: 26, height: 26, color: BRAND });
    text(page, doc.seller.name.charAt(0).toUpperCase() || "A", M + 8, top + 1, { font: bold, size: 14, color: WHITE });
    text(page, doc.seller.name, M + 36, top + 6, { font: bold, size: 13, color: WHITE });
    if (!compact) text(page, "AI marketing for restaurants", M + 36, top - 8, { size: 8.5, color: GRAY_300 });
    right(page, doc.status === "DRAFT" ? "DRAFT INVOICE" : "INVOICE", W - M, top + 6, { font: bold, size: compact ? 12 : 16, color: WHITE });
    right(page, doc.numberLabel ?? "Not yet issued", W - M, top - 10, { size: 9.5, color: GRAY_300 });
    return H - band - 34;
  };

  let page = pdf.addPage([W, H]);
  let y = header(page, false);

  // Billed to · details
  text(page, "BILLED TO", M, y, { font: bold, size: 7.5, color: MUTED });
  text(page, "DETAILS", 360, y, { font: bold, size: 7.5, color: MUTED });
  let left = y - 16;
  text(page, doc.billTo.name, M, left, { font: bold, size: 11 });
  for (const line of [...(doc.billTo.address ? wrap(doc.billTo.address, 260) : []), ...(doc.billTo.email ? [doc.billTo.email] : [])]) {
    left -= 14;
    text(page, line, M, left, { color: MUTED });
  }
  const balance = Math.max(0, doc.totalMinor - doc.paidMinor);
  const details: [string, string][] = [
    ["Issued", dateText(doc.issueDate)],
    ["Due", dateText(doc.dueDate)],
    ["Status", INVOICE_STATUS_LABEL[doc.status]],
    ...(doc.project ? ([["Project", doc.project]] as [string, string][]) : []),
  ];
  let rightY = y - 16;
  for (const [k, v] of details) {
    text(page, k, 360, rightY, { color: MUTED });
    right(page, v.length > 30 ? `${v.slice(0, 29)}…` : v, W - M, rightY, { font: k === "Status" ? bold : regular, color: k === "Status" ? (doc.status === "PAID" ? BRAND : doc.status === "OVERDUE" ? DANGER : INK) : INK });
    rightY -= 14;
  }
  y = Math.min(left, rightY) - 26;

  // Amount due panel
  page.drawRectangle({ x: M, y: y - 34, width: W - 2 * M, height: 44, color: GREEN_50, borderColor: GREEN_100, borderWidth: 0.75 });
  text(page, doc.status === "PAID" ? "Paid in full" : doc.status === "VOID" ? "This invoice is void" : "Amount due", M + 16, y - 17, { font: bold, size: 10 });
  if (doc.status !== "VOID") right(page, money(doc.status === "PAID" ? doc.totalMinor : balance), W - M - 16, y - 19, { font: bold, size: 16 });
  if (doc.status !== "PAID" && doc.status !== "VOID") text(page, `by ${dateText(doc.dueDate)}`, M + 16, y - 29, { size: 8.5, color: MUTED });
  y -= 64;

  // Line items
  const cols = { desc: M, qty: 360, rate: 450, amount: W - M };
  const tableHead = () => {
    text(page, "DESCRIPTION", cols.desc, y, { font: bold, size: 7.5, color: MUTED });
    right(page, "QTY", cols.qty, y, { font: bold, size: 7.5, color: MUTED });
    right(page, "RATE", cols.rate, y, { font: bold, size: 7.5, color: MUTED });
    right(page, "AMOUNT", cols.amount, y, { font: bold, size: 7.5, color: MUTED });
    page.drawLine({ start: { x: M, y: y - 7 }, end: { x: W - M, y: y - 7 }, thickness: 0.75, color: BRAND });
    y -= 24;
  };
  tableHead();
  for (const l of doc.lines) {
    const rows = wrap(l.description, cols.qty - cols.desc - 50);
    const need = rows.length * 13 + 12;
    if (y - need < 80) {
      page = pdf.addPage([W, H]);
      y = header(page, true);
      tableHead();
    }
    rows.forEach((r, i) => text(page, r, cols.desc, y - i * 13));
    right(page, formatQuantity(l.quantityMilli), cols.qty, y);
    right(page, money(l.rateMinor), cols.rate, y);
    right(page, money(l.amountMinor), cols.amount, y);
    y -= rows.length * 13 - 13 + 12;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: GREEN_100 });
    y -= 16;
  }

  // Totals
  const totals: [string, string, boolean][] = [
    ["Subtotal", money(doc.subtotalMinor), false],
    ["Total", money(doc.totalMinor), true],
    ...(doc.paidMinor > 0 ? ([["Paid", `– ${money(doc.paidMinor)}`, false]] as [string, string, boolean][]) : []),
    ...(doc.status !== "VOID" ? ([["Balance due", money(balance), true]] as [string, string, boolean][]) : []),
  ];
  if (y - totals.length * 18 - 20 < 80) {
    page = pdf.addPage([W, H]);
    y = header(page, true);
  }
  for (const [k, v, strong] of totals) {
    text(page, k, 380, y, { font: strong ? bold : regular, color: strong ? INK : MUTED });
    right(page, v, W - M, y, { font: strong ? bold : regular, size: strong ? 11 : 9.5 });
    y -= 18;
  }
  y -= 10;

  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    if (y - rows.length * 13 - 30 < 70) {
      page = pdf.addPage([W, H]);
      y = header(page, true);
    }
    text(page, title, M, y, { font: bold, size: 7.5, color: MUTED });
    y -= 15;
    for (const r of rows) {
      text(page, r, M, y, { color: INK });
      y -= 13;
    }
    y -= 12;
  };
  section(
    "PAYMENTS RECEIVED",
    doc.payments.map((p) => `${dateText(p.paidAt)}  ·  ${PAYMENT_METHOD_LABEL[p.method as PaymentMethod] ?? p.method}${p.reference ? `  ·  ${p.reference}` : ""}  ·  ${money(p.amountMinor)}`),
  );
  if (doc.notes) section("NOTES", wrap(doc.notes, W - 2 * M));

  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.5, color: GREEN_100 });
    const seller = [doc.seller.name, ...(doc.seller.address ? doc.seller.address.split("\n") : []), doc.seller.email].filter(Boolean).join("  ·  ");
    text(p, seller.length > 110 ? `${seller.slice(0, 109)}…` : seller, M, 36, { size: 7.5, color: MUTED });
    right(p, `Page ${i + 1} of ${pages.length}`, W - M, 36, { size: 7.5, color: MUTED });
    text(p, "Thank you for your business.", M, 24, { size: 7.5, color: BRAND });
  });

  return pdf.save();
}

/** For file names: "INV-0007.pdf", or the draft's id. */
export const pdfFileName = (doc: { numberLabel: string | null }, id: string) => `${(doc.numberLabel ?? `draft-${id.slice(-6)}`).replace(/[^\w.-]+/g, "_")}.pdf`;
