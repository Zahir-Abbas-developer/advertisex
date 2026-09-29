import "server-only";

import { randomUUID } from "node:crypto";

import { prisma, transaction } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { notify } from "@/lib/notifications";
import { remove, save } from "@/lib/uploads";
import { storedRoleValues } from "@/config/permissions";
import { aiProvider } from "@/modules/ai";
import { dayKey } from "@/modules/billing/domain";
import { previousMonth } from "@/modules/client-analytics/metrics";
import { resultsFor } from "@/modules/client-analytics/server";
import { normalizeProjectStatus } from "@/modules/projects/domain";
import { summarize } from "@/modules/projects/server";
import { CLIENT_STATUS_TEXT } from "@/modules/portal/views";
import { notifyAccount } from "@/modules/portal/server";
import { acceptSummary, highlightsOf, monthLabelOf, reportTitle, SUMMARY_SYSTEM, summaryPrompt, templateSummary, type ReportData } from "@/modules/monthly-reports/domain";
import { renderReportPdf } from "@/modules/monthly-reports/pdf";

/**
 * Monthly reports (Phase 8 scope 4): generated as a DRAFT that NEEDS_REVIEW,
 * edited and approved by a person, and only then published to the client's
 * library. Idempotent per client and month.
 */

export class ReportError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** The frozen snapshot of a client's month. */
export async function buildReportData(clientId: string, month: string, now = new Date()): Promise<ReportData> {
  const tz = await companyTimezone();
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
    select: { businessName: true, services: { where: { status: { not: "ENDED" } }, select: { service: { select: { name: true } } } } },
  });
  const results = await resultsFor(clientId, month);
  const channels = results.channels
    .filter((c) => c.hasData)
    .map((c) => ({ channel: c.channel, label: c.label, question: c.question, headline: c.headline, metrics: c.metrics }));

  const projects = await prisma.project.findMany({
    where: { clientId, status: { not: "CANCELLED" }, startDate: { lte: new Date(`${month}-28T23:59:59Z`) } },
    orderBy: { endDate: "asc" },
    select: { id: true, title: true, status: true, startDate: true, endDate: true, stages: { select: { name: true, status: true, order: true } }, milestones: { select: { title: true, status: true, dueDate: true, completedAt: true }, orderBy: { dueDate: "asc" } } },
  });
  const summaries = await summarize(projects, now);
  const reportProjects = projects
    .filter((p) => normalizeProjectStatus(p.status) !== "COMPLETED" || p.milestones.some((m) => m.completedAt && dayKey(m.completedAt, tz).slice(0, 7) === month))
    .map((p) => {
      const status = normalizeProjectStatus(p.status);
      const current = [...p.stages].sort((a, b) => a.order - b.order).find((s) => s.status !== "DONE");
      return {
        title: p.title,
        progress: summaries.get(p.id)?.progress.percent ?? 0,
        statusText: CLIENT_STATUS_TEXT[status] ?? "In progress",
        currentStage: status === "COMPLETED" ? null : current?.name ?? null,
        doneThisMonth: p.milestones.filter((m) => m.completedAt && dayKey(m.completedAt, tz).slice(0, 7) === month).map((m) => m.title),
        nextUp: p.milestones.filter((m) => m.status !== "DONE" && m.dueDate).slice(0, 2).map((m) => ({ title: m.title, due: m.dueDate!.toISOString().slice(0, 10) })),
      };
    });

  const data: ReportData = {
    version: 1,
    clientName: client.businessName,
    month,
    monthLabel: monthLabelOf(month),
    currency: results.currency,
    services: client.services.map((s) => s.service.name),
    channels,
    projects: reportProjects,
    highlights: [],
    demoData: results.demoData,
    generatedAt: now.toISOString(),
  };
  data.highlights = highlightsOf(channels, reportProjects);
  return data;
}

/** AI draft when a provider is configured and the draft passes the guard; the template otherwise. */
export async function writeSummary(d: ReportData): Promise<{ summary: string; source: "AI" | "TEMPLATE" }> {
  const ai = aiProvider();
  if (ai) {
    try {
      const draft = await ai.complete({ system: SUMMARY_SYSTEM, prompt: summaryPrompt(d), maxTokens: 400, timeoutMs: 15_000 });
      const ok = acceptSummary(draft, d);
      if (ok) return { summary: ok, source: "AI" };
    } catch {
      // AI is never allowed to stop a report: fall through to the template.
    }
  }
  return { summary: templateSummary(d), source: "TEMPLATE" };
}

async function sellerName(organizationId: string) {
  return (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } })).name;
}

/** Who reviews a client's generated report: the founders, the department's managers, and the account lead. */
async function reviewersFor(client: { organizationId: string | null; departmentId: string; assigneeId: string | null }) {
  const [founders, leads] = await Promise.all([
    prisma.user.findMany({ where: { organizationId: client.organizationId ?? undefined, isActive: true, role: { in: storedRoleValues("FOUNDER") } }, select: { id: true } }),
    prisma.departmentMembership.findMany({ where: { departmentId: client.departmentId, roleInDept: "LEAD", user: { isActive: true } }, select: { userId: true } }),
  ]);
  return [...new Set([...founders.map((f) => f.id), ...leads.map((l) => l.userId), ...(client.assigneeId ? [client.assigneeId] : [])])];
}

/**
 * Generates a client's monthly report as a draft awaiting review. Returns
 * the existing one if the month already has a generated report (unless it is
 * still a draft and `regenerate` is set, in which case it is rebuilt).
 */
export async function generateMonthlyReport(clientId: string, month: string, opts: { createdById?: string | null; regenerate?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId }, select: { id: true, businessName: true, organizationId: true, departmentId: true, assigneeId: true } });
  if (!client.organizationId) throw new ReportError("This client has no organization", 422);
  const existing = await prisma.clientReport.findFirst({ where: { clientId, periodMonth: month, kind: "MONTHLY", generated: true }, include: { file: true } });
  if (existing && (!opts.regenerate || existing.status === "PUBLISHED")) return { report: existing, created: false };

  const data = await buildReportData(clientId, month, now);
  const { summary, source } = await writeSummary(data);
  const bytes = Buffer.from(await renderReportPdf(data, summary, await sellerName(client.organizationId)));
  const storedName = await save(randomUUID(), "application/pdf", bytes);
  const filename = `${client.businessName} — ${reportTitle(data)}.pdf`.replace(/[^\w .—-]+/g, "");

  const report = await transaction(async (tx) => {
    if (existing) {
      await tx.file.update({ where: { id: existing.fileId }, data: { storedName, size: bytes.length, filename } });
      return tx.clientReport.update({ where: { id: existing.id }, data: { summary, summarySource: source, data: JSON.stringify(data), reviewState: "NEEDS_REVIEW" }, include: { file: true } });
    }
    const file = await tx.file.create({ data: { organizationId: client.organizationId!, uploaderId: opts.createdById ?? null, clientId, filename, storedName, mimeType: "application/pdf", size: bytes.length, visibility: "INTERNAL" } });
    return tx.clientReport.create({
      data: { organizationId: client.organizationId!, clientId, title: reportTitle(data), kind: "MONTHLY", periodMonth: month, fileId: file.id, status: "DRAFT", generated: true, reviewState: "NEEDS_REVIEW", summary, summarySource: source, data: JSON.stringify(data), createdById: opts.createdById ?? null },
      include: { file: true },
    });
  });
  if (existing) await remove(existing.file.storedName).catch(() => undefined);

  for (const userId of await reviewersFor(client)) {
    await notify({
      userId,
      type: "REPORT_READY",
      title: `${client.businessName}: ${data.monthLabel} report ready for review`,
      body: source === "AI" ? "Drafted with AI from the month's results — read it, edit if needed, then publish." : "Drafted from the month's results — read it, edit if needed, then publish.",
      href: `/clients/${clientId}?tab=reports`,
      dedupeKey: `report-review:${report.id}:${report.updatedAt.getTime()}:${userId}`,
    });
  }
  return { report, created: !existing };
}

/** A reviewer's edit to the summary: re-renders the PDF; still needs approval. */
export async function reviseSummary(reportId: string, summary: string) {
  const r = await prisma.clientReport.findUniqueOrThrow({ where: { id: reportId }, include: { file: true } });
  if (!r.generated || !r.data) throw new ReportError("Only a generated report has a summary to edit", 409);
  if (r.status === "PUBLISHED") throw new ReportError("It's already published — withdraw it first", 409);
  const data = JSON.parse(r.data) as ReportData;
  const bytes = Buffer.from(await renderReportPdf(data, summary, await sellerName(r.organizationId)));
  const storedName = await save(randomUUID(), "application/pdf", bytes);
  await transaction(async (tx) => {
    await tx.file.update({ where: { id: r.fileId }, data: { storedName, size: bytes.length } });
    await tx.clientReport.update({ where: { id: r.id }, data: { summary, summarySource: "EDITED", reviewState: "NEEDS_REVIEW" } });
  });
  await remove(r.file.storedName).catch(() => undefined);
}

/** Approve and publish: the only way a generated report reaches the portal. The client is told. */
export async function approveAndPublish(reportId: string, reviewerId: string) {
  const r = await prisma.clientReport.findUniqueOrThrow({ where: { id: reportId }, include: { client: { select: { clientAccountId: true } } } });
  if (!r.generated) throw new ReportError("Publish uploaded reports from the library", 409);
  if (r.status === "PUBLISHED") return r;
  const updated = await transaction(async (tx) => {
    await tx.file.update({ where: { id: r.fileId }, data: { visibility: "CLIENT" } });
    return tx.clientReport.update({ where: { id: r.id }, data: { reviewState: "APPROVED", reviewedById: reviewerId, reviewedAt: new Date(), status: "PUBLISHED", publishedAt: new Date() } });
  });
  if (r.client.clientAccountId) {
    await notifyAccount(r.client.clientAccountId, "reports", { type: "REPORT_SHARED", title: `Your ${monthLabelOf(r.periodMonth)} report is ready`, body: "Your results and what we did this month, in one place.", href: `/portal/reports/${r.id}` });
  }
  return updated;
}

/**
 * The monthly job (the morning run, in the first five days of a month):
 * last month's report for every active client with results or open work.
 * Idempotent — a client's month is generated once.
 */
export async function runMonthlyReports(now = new Date()) {
  const today = dayKey(now, await companyTimezone());
  if (Number(today.slice(8, 10)) > 5) return { status: "skipped" as const, reason: "outside the first five days of the month", created: 0 };
  const month = previousMonth(today.slice(0, 7));
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE", organizationId: { not: null } },
    select: { id: true, _count: { select: { metrics: true, projects: true } } },
  });
  let created = 0;
  for (const c of clients) {
    if (c._count.metrics === 0 && c._count.projects === 0) continue;
    const out = await generateMonthlyReport(c.id, month, { now });
    if (out.created) created += 1;
  }
  return { status: "ok" as const, month, created };
}
