/**
 * Monthly client reports (Phase 8 scope 4) — the pure part: what a report
 * holds, the plain-language highlights, the deterministic summary, and the
 * guard that keeps an AI-written summary honest. The report is a frozen
 * snapshot (ClientReport.data): the in-app view and the PDF both render from
 * it, never from live data.
 */

import type { MetricView } from "@/modules/client-analytics/metrics";

export type ReportChannel = { channel: string; label: string; question: string; headline: string; metrics: MetricView[] };
export type ReportProject = { title: string; progress: number; statusText: string; currentStage: string | null; doneThisMonth: string[]; nextUp: { title: string; due: string }[] };

export type ReportData = {
  version: 1;
  clientName: string;
  month: string;
  monthLabel: string;
  currency: string;
  services: string[];
  channels: ReportChannel[];
  projects: ReportProject[];
  highlights: string[];
  demoData: boolean;
  generatedAt: string;
};

export const monthLabelOf = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Up to six one-line facts, in the order they matter to a restaurant owner:
 * each channel's headline metric against last month, then delivery. Falls
 * are stated plainly, never as alarms (§7: a fall is data).
 */
export function highlightsOf(channels: readonly ReportChannel[], projects: readonly ReportProject[]): string[] {
  const out: string[] = [];
  for (const c of channels) {
    const m = c.metrics.find((x) => x.label === c.headline) ?? c.metrics.find((x) => !x.derived && x.value !== null);
    if (!m || m.value === null) continue;
    if (m.previous === null || m.previous === 0) {
      out.push(`${c.label}: ${m.display} ${m.label.toLowerCase()} this month.`);
      continue;
    }
    const pct = Math.round(((m.value - m.previous) / m.previous) * 100);
    const move = pct === 0 ? "level with last month" : pct > 0 ? `up ${pct}% on last month` : `down ${Math.abs(pct)}% on last month`;
    out.push(`${c.label}: ${m.display} ${m.label.toLowerCase()}, ${move}.`);
  }
  for (const p of projects) {
    if (p.doneThisMonth.length) out.push(`${p.title}: ${p.doneThisMonth.length} milestone${p.doneThisMonth.length === 1 ? "" : "s"} completed; now ${p.progress}% done.`);
  }
  return out.slice(0, 6);
}

/** The deterministic summary — used when AI is off, or when the AI draft fails the guard. */
export function templateSummary(d: ReportData): string {
  const lead = `Here is how ${d.monthLabel} went for ${d.clientName}.`;
  const facts = d.highlights.length ? d.highlights.join(" ") : "There are no results recorded for this month yet.";
  const active = d.projects.filter((p) => p.progress < 100);
  const delivery = active.length ? ` Work continues on ${active.map((p) => p.title).join(" and ")}${active[0].nextUp[0] ? `; next up is ${active[0].nextUp[0].title.toLowerCase()}` : ""}.` : "";
  return `${lead} ${facts}${delivery} Your team is on hand if you have any questions.`;
}

export const SUMMARY_SYSTEM =
  "You write the opening summary of a monthly marketing report for a restaurant owner. Write 70–130 words of warm, plain English: no jargon, no headings, no bullet points, no markdown. Use ONLY the facts provided — never invent a number, a percentage or a claim. You may round nothing and add no figures. If a figure fell, say so calmly and without blame. End with one sentence about what the team will focus on next, based only on the facts.";

export function summaryPrompt(d: ReportData): string {
  return [
    `Restaurant: ${d.clientName}`,
    `Month: ${d.monthLabel}`,
    `Services: ${d.services.join(", ") || "—"}`,
    "Facts:",
    ...d.highlights.map((h) => `- ${h}`),
    ...d.projects.map((p) => `- Project ${p.title}: ${p.progress}% done${p.currentStage ? `, now in ${p.currentStage}` : ""}${p.nextUp[0] ? `; next: ${p.nextUp[0].title}` : ""}.`),
  ].join("\n");
}

/** Every number that appears in the facts, as written (so "12%" allows 12). */
function allowedNumbers(d: ReportData): Set<string> {
  const text = [...d.highlights, ...d.projects.map((p) => `${p.progress} ${p.title} ${p.currentStage ?? ""} ${p.nextUp.map((n) => n.title).join(" ")}`), d.monthLabel, d.clientName].join(" ");
  return new Set((text.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, "").replace(/,/g, "")));
}

/**
 * The AI draft is kept only if it is plain prose of a sensible length and
 * every number in it appears in the facts it was given. Otherwise the
 * deterministic summary is used — a report never states a figure we didn't.
 */
export function acceptSummary(text: string, d: ReportData): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 120 || clean.length > 1200) return null;
  if (/[#*`]|^- |\n- /.test(text)) return null;
  const allowed = allowedNumbers(d);
  const used = (clean.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, "").replace(/,/g, ""));
  return used.every((n) => allowed.has(n)) ? clean : null;
}

export const reportTitle = (d: Pick<ReportData, "monthLabel">) => `Monthly report — ${d.monthLabel}`;
