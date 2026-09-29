import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { ReportData } from "@/modules/monthly-reports/domain";

/**
 * The monthly report as a branded PDF (Forest & Mint): a deep green masthead,
 * the summary, highlights, each channel's figures against last month (direction in words; green when the change is an improvement, gray otherwise), and
 * project progress. Rendered from the frozen ReportData, so the PDF and the
 * in-app report always say the same thing.
 */

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const GREEN_950 = hex("#022313");
const BRAND = hex("#0E5B37");
const GREEN_600 = hex("#279D61");
const GREEN_100 = hex("#CEE4D9");
const GREEN_50 = hex("#E7F4EB");
const INK = GREEN_950;
const INK_2 = hex("#3D5E4C");
const MUTED = hex("#656565");
const GRAY_300 = hex("#CBCBCD");
const GRAY_50 = hex("#F8F8FB");
const WHITE = hex("#FFFFFF");

const W = 612;
const H = 792;
const M = 48;

export async function renderReportPdf(d: ReportData, summary: string, sellerName: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.clientName} — Monthly report, ${d.monthLabel}`);
  pdf.setAuthor(sellerName);
  pdf.setCreator("Advertise X");
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const safe = (text: string, font: PDFFont = regular) =>
    [...text.replace(/\r/g, "")].map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return "?";
      }
    }).join("");
  type Opt = { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> };
  const text = (page: PDFPage, value: string, x: number, y: number, o: Opt = {}) => page.drawText(safe(value, o.font ?? regular), { x, y, font: o.font ?? regular, size: o.size ?? 10, color: o.color ?? INK });
  const right = (page: PDFPage, value: string, xr: number, y: number, o: Opt = {}) => {
    const f = o.font ?? regular;
    const v = safe(value, f);
    text(page, v, xr - f.widthOfTextAtSize(v, o.size ?? 10), y, o);
  };
  const wrap = (value: string, width: number, font = regular, size = 10) => {
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

  let page = pdf.addPage([W, H]);
  let y = 0;
  const masthead = (full: boolean) => {
    const band = full ? 150 : 60;
    page.drawRectangle({ x: 0, y: H - band, width: W, height: band, color: GREEN_950 });
    page.drawRectangle({ x: 0, y: H - band - 2, width: W, height: 2, color: GREEN_600 });
    const top = H - (full ? 52 : 38);
    page.drawRectangle({ x: M, y: top - 6, width: 24, height: 24, color: BRAND });
    text(page, sellerName.charAt(0).toUpperCase() || "A", M + 7, top + 1, { font: bold, size: 13, color: WHITE });
    text(page, sellerName, M + 34, top + 5, { font: bold, size: 12, color: WHITE });
    right(page, full ? "MONTHLY REPORT" : `${d.clientName} · ${d.monthLabel}`, W - M, top + 5, { font: bold, size: full ? 10 : 9, color: GRAY_300 });
    if (full) {
      text(page, d.clientName, M, H - 102, { font: bold, size: 26, color: WHITE });
      text(page, d.monthLabel, M, H - 124, { size: 12, color: GRAY_300 });
    }
    y = H - band - 34;
  };
  const ensure = (need: number) => {
    if (y - need < 70) {
      page = pdf.addPage([W, H]);
      masthead(false);
    }
  };
  const heading = (label: string) => {
    ensure(40);
    text(page, label, M, y, { font: bold, size: 14, color: BRAND });
    y -= 20;
  };

  masthead(true);

  // Summary
  const lines = wrap(summary, W - 2 * M - 32, regular, 11);
  const boxH = lines.length * 15 + 26;
  page.drawRectangle({ x: M, y: y - boxH + 12, width: W - 2 * M, height: boxH, color: GREEN_50, borderColor: GREEN_100, borderWidth: 0.75 });
  lines.forEach((l, i) => text(page, l, M + 16, y - 6 - i * 15, { size: 11, color: INK }));
  y -= boxH + 18;

  if (d.highlights.length) {
    heading("Highlights");
    for (const h of d.highlights) {
      const hl = wrap(h, W - 2 * M - 16);
      ensure(hl.length * 14 + 4);
      page.drawCircle({ x: M + 3, y: y + 3.5, size: 2, color: GREEN_600 });
      hl.forEach((l, i) => text(page, l, M + 14, y - i * 14, { color: INK }));
      y -= hl.length * 14 + 6;
    }
    y -= 10;
  }

  for (const c of d.channels) {
    const shown = c.metrics.filter((m) => m.value !== null);
    if (shown.length === 0) continue;
    heading(c.label);
    text(page, c.question, M, y + 4, { size: 9, color: MUTED });
    y -= 16;
    const colW = (W - 2 * M - 16) / 3;
    for (let i = 0; i < shown.length; i += 3) {
      ensure(56);
      shown.slice(i, i + 3).forEach((m, j) => {
        const x = M + j * (colW + 8);
        page.drawRectangle({ x, y: y - 40, width: colW, height: 50, color: GRAY_50, borderColor: GREEN_100, borderWidth: 0.5 });
        text(page, m.label, x + 10, y - 2, { size: 8, color: MUTED });
        text(page, m.display, x + 10, y - 20, { font: bold, size: 14, color: INK });
        if (m.good !== null) text(page, `${(m.change ?? 0) > 0 ? "Up" : "Down"} on last month`, x + 10, y - 33, { size: 7.5, color: m.good ? BRAND : MUTED });
      });
      y -= 60;
    }
    y -= 6;
  }

  if (d.projects.length) {
    heading("Your projects");
    for (const p of d.projects) {
      ensure(64);
      text(page, p.title, M, y, { font: bold, size: 11 });
      right(page, `${p.progress}% · ${p.statusText}`, W - M, y, { size: 9, color: INK_2 });
      y -= 12;
      page.drawRectangle({ x: M, y, width: W - 2 * M, height: 5, color: GREEN_100 });
      page.drawRectangle({ x: M, y, width: ((W - 2 * M) * Math.max(0, Math.min(100, p.progress))) / 100, height: 5, color: GREEN_600 });
      y -= 16;
      if (p.currentStage) {
        text(page, `Now: ${p.currentStage}`, M, y, { size: 9, color: INK_2 });
        y -= 13;
      }
      if (p.doneThisMonth.length) {
        for (const l of wrap(`Done this month: ${p.doneThisMonth.join(", ")}`, W - 2 * M, regular, 9)) {
          ensure(14);
          text(page, l, M, y, { size: 9, color: INK_2 });
          y -= 13;
        }
      }
      if (p.nextUp.length) {
        text(page, `Next: ${p.nextUp.map((n) => n.title).join(", ")}`.slice(0, 110), M, y, { size: 9, color: INK_2 });
        y -= 13;
      }
      y -= 10;
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.5, color: GREEN_100 });
    text(p, d.demoData ? "Includes demonstration figures — not live account data." : `Prepared by ${sellerName} for ${d.clientName}.`, M, 36, { size: 7.5, color: MUTED });
    right(p, `Page ${i + 1} of ${pages.length}`, W - M, 36, { size: 7.5, color: MUTED });
  });
  return pdf.save();
}
