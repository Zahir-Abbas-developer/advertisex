import "server-only";

import { prisma } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { startOfCompanyDay } from "@/lib/date";
import { LEAD_SOURCE_LABEL } from "@/modules/leads/domain";
import { OUTREACH_KINDS, OUTREACH_LABEL, outreachKindOf, type OutreachKind } from "@/modules/outreach/domain";
import { balanceOf, dayKey, monthlyMinor } from "@/modules/billing/domain";
import { attendanceFor, directoryFor, performanceFor } from "@/modules/team/server";
import type { Principal } from "@/modules/rbac/authorize";
import { addDays, agingOf, breakdown, delta, inBounds, periodBounds, rate, rateDelta, retentionOf, series, type Bounds, type Period } from "@/modules/analytics/domain";

/**
 * The founder Command Center (Phase 8 scope 1): one call, five sections, each
 * figure for the period and the comparison period before it. Formulas:
 * docs/METRICS.md → "Command Center". Computed from the database, then cached
 * in AnalyticsSnapshot for five minutes (and warmed by the morning job).
 */

const TTL_MS = 5 * 60_000;

export async function cached<T>(organizationId: string, key: string, compute: () => Promise<T>, ttlMs = TTL_MS): Promise<T & { computedAt: string; cached: boolean }> {
  const hit = await prisma.analyticsSnapshot.findUnique({ where: { organizationId_key: { organizationId, key } } });
  if (hit && Date.now() - hit.computedAt.getTime() < ttlMs) return { ...(JSON.parse(hit.payload) as T), computedAt: hit.computedAt.toISOString(), cached: true };
  const value = await compute();
  const computedAt = new Date();
  await prisma.analyticsSnapshot.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, payload: JSON.stringify(value), computedAt },
    update: { payload: JSON.stringify(value), computedAt },
  });
  return { ...value, computedAt: computedAt.toISOString(), cached: false };
}

/** Drops an organization's cached figures (after a big import, say). */
export const invalidate = (organizationId: string) => prisma.analyticsSnapshot.deleteMany({ where: { organizationId } });

export async function commandCenter(principal: Principal, period: Period, now = new Date()) {
  const organizationId = principal.organizationId!;
  const tz = await companyTimezone();
  const today = dayKey(now, tz);
  return cached(organizationId, `command:${period}:${today}`, () => compute(principal, period, now, tz, today));
}

async function compute(principal: Principal, period: Period, now: Date, tz: string, today: string) {
  const organizationId = principal.organizationId!;
  const b = periodBounds(period, today);
  const earliest = new Date(`${addDays(b.prevFrom, -1)}T00:00:00Z`);
  const k = (d: Date) => dayKey(d, tz);
  const cur = (d: Date) => inBounds(k(d), b.from, b.to);
  const prev = (d: Date) => inBounds(k(d), b.prevFrom, b.prevTo);
  const dept = { department: { organizationId } };

  const [org, stages, newLeads, closedDeals, stageMoves, openLeads, activities, users, invoices, payments, services, projects, milestones] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { currency: true } }),
    prisma.pipelineStage.findMany({ where: dept, select: { departmentId: true, key: true, kind: true } }),
    prisma.lead.findMany({ where: { ...dept, createdAt: { gte: earliest } }, select: { createdAt: true, source: true, department: { select: { id: true, shortLabel: true } } } }),
    prisma.salesActivity.findMany({ where: { ...dept, type: "DEAL_CLOSED", occurredAt: { gte: earliest } }, select: { occurredAt: true, leadId: true, lead: { select: { dealValue: true } } } }),
    prisma.leadStageEvent.findMany({ where: { lead: dept, at: { gte: earliest } }, select: { at: true, leadId: true, toStage: true, departmentId: true } }),
    prisma.lead.findMany({ where: dept, select: { departmentId: true, stage: true, dealValue: true } }),
    prisma.salesActivity.findMany({ where: { ...dept, occurredAt: { gte: earliest } }, select: { type: true, occurredAt: true, userId: true } }),
    prisma.user.findMany({ where: { organizationId }, select: { id: true, name: true } }),
    prisma.invoice.findMany({ where: { organizationId, status: { not: "DRAFT" } }, select: { status: true, currency: true, totalMinor: true, paidMinor: true, issueDate: true } }),
    prisma.payment.findMany({ where: { organizationId, reversedAt: null, paidAt: { gte: earliest } }, select: { amountMinor: true, currency: true, paidAt: true } }),
    prisma.clientService.findMany({ where: { organizationId, status: "ACTIVE" }, select: { price: true, billing: true, status: true } }),
    prisma.project.findMany({ where: { organizationId }, select: { status: true, completedAt: true, delayedAt: true, startDate: true } }),
    prisma.projectMilestone.findMany({ where: { project: { organizationId }, dueDate: { gte: earliest, lte: now } }, select: { dueDate: true, completedAt: true, status: true } }),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const kindOf = new Map(stages.map((s) => [`${s.departmentId}:${s.key}`, s.kind]));

  // ---- Leads -----------------------------------------------------------------
  const wonOnce = (inPeriod: (d: Date) => boolean) => {
    const seen = new Map<string, number>();
    for (const d of closedDeals) if (d.leadId && inPeriod(d.occurredAt) && !seen.has(d.leadId)) seen.set(d.leadId, d.lead?.dealValue ?? 0);
    return { count: seen.size, value: [...seen.values()].reduce((s, v) => s + v, 0) };
  };
  const lostIn = (inPeriod: (d: Date) => boolean) => new Set(stageMoves.filter((m) => inPeriod(m.at) && kindOf.get(`${m.departmentId}:${m.toStage}`) === "LOST").map((m) => m.leadId)).size;
  const won = wonOnce(cur);
  const wonPrev = wonOnce(prev);
  const lost = lostIn(cur);
  const lostPrev = lostIn(prev);
  // Won per bucket: the first DEAL_CLOSED of each lead, as in the headline figure.
  const firstClose = new Map<string, Date>();
  for (const d of [...closedDeals].sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime())) if (d.leadId && !firstClose.has(d.leadId)) firstClose.set(d.leadId, d.occurredAt);
  const wonSeries = series([...firstClose.values()], (d) => k(d), b);
  const openValue = openLeads.filter((l) => kindOf.get(`${l.departmentId}:${l.stage}`) === "OPEN").reduce((s, l) => s + l.dealValue, 0);
  const leads = {
    newLeads: delta(newLeads.filter((l) => cur(l.createdAt)).length, newLeads.filter((l) => prev(l.createdAt)).length),
    won: delta(won.count, wonPrev.count),
    wonValue: delta(won.value * 100, wonPrev.value * 100),
    conversion: rateDelta(rate(won.count, won.count + lost), rate(wonPrev.count, wonPrev.count + lostPrev)),
    openPipelineMinor: openValue * 100,
    trend: series(newLeads, (l) => k(l.createdAt), b).map((p, i) => ({ ...p, won: wonSeries[i].value })),
    bySource: breakdown(newLeads.filter((l) => cur(l.createdAt)).map((l) => ({ key: l.source, label: sourceLabel(l.source), value: 1 }))),
    byDepartment: breakdown(newLeads.filter((l) => cur(l.createdAt)).map((l) => ({ key: l.department.id, label: l.department.shortLabel, value: 1 }))),
  };

  // ---- Outreach -----------------------------------------------------------------
  const outreachRows = activities.map((a) => ({ ...a, kind: outreachKindOf(a.type) })).filter((a): a is typeof a & { kind: OutreachKind } => a.kind !== null && a.kind !== "dealsClosed");
  const countKind = (kind: OutreachKind, inPeriod: (d: Date) => boolean) => outreachRows.filter((a) => a.kind === kind && inPeriod(a.occurredAt)).length;
  const outreach = {
    total: delta(outreachRows.filter((a) => cur(a.occurredAt)).length, outreachRows.filter((a) => prev(a.occurredAt)).length),
    byKind: OUTREACH_KINDS.filter((kind) => kind !== "dealsClosed").map((kind) => ({ key: kind, label: OUTREACH_LABEL[kind], ...delta(countKind(kind, cur), countKind(kind, prev)) })),
    trend: series(outreachRows, (a) => k(a.occurredAt), b),
    byPerson: breakdown(outreachRows.filter((a) => cur(a.occurredAt)).map((a) => ({ key: a.userId!, label: nameOf.get(a.userId!) ?? "Someone", value: 1 })), 6),
  };

  // ---- Sales & revenue (organization currency; docs/METRICS.md → "Money") -----------------
  const inCurrency = <T extends { currency: string }>(rows: T[]) => rows.filter((r) => r.currency === org.currency);
  const pays = inCurrency(payments);
  const invs = inCurrency(invoices);
  const sumPaid = (inPeriod: (d: Date) => boolean) => pays.filter((p) => inPeriod(p.paidAt)).reduce((s, p) => s + p.amountMinor, 0);
  const issued = invs.filter((i) => i.issueDate && i.status !== "VOID");
  const sumInvoiced = (from: string, to: string) => issued.filter((i) => inBounds(i.issueDate!.toISOString().slice(0, 10), from, to)).reduce((s, i) => s + i.totalMinor, 0);
  const revenue = {
    currency: org.currency,
    received: delta(sumPaid(cur), sumPaid(prev)),
    invoiced: delta(sumInvoiced(b.from, b.to), sumInvoiced(b.prevFrom, b.prevTo)),
    mrrMinor: services.reduce((s, x) => s + monthlyMinor({ priceWhole: x.price, billing: x.billing, status: x.status }), 0),
    outstandingMinor: invs.filter((i) => ["SENT", "PARTIALLY_PAID", "OVERDUE"].includes(i.status)).reduce((s, i) => s + balanceOf(i), 0),
    overdueMinor: invs.filter((i) => i.status === "OVERDUE").reduce((s, i) => s + balanceOf(i), 0),
    trend: series(pays, (p) => k(p.paidAt), b, (p) => p.amountMinor),
  };

  // ---- Projects --------------------------------------------------------------------
  const active = projects.filter((p) => ["PLANNING", "ACTIVE", "ON_HOLD"].includes(p.status));
  const dueIn = (from: string, to: string) => milestones.filter((m) => m.dueDate && inBounds(m.dueDate.toISOString().slice(0, 10), from, to));
  const onTime = (ms: typeof milestones) => ms.filter((m) => m.completedAt && k(m.completedAt) <= m.dueDate!.toISOString().slice(0, 10)).length;
  const dueNow = dueIn(b.from, b.to);
  const duePrev = dueIn(b.prevFrom, b.prevTo);
  const projectsSection = {
    active: active.length,
    delayed: active.filter((p) => p.delayedAt).length,
    started: delta(projects.filter((p) => cur(p.startDate)).length, projects.filter((p) => prev(p.startDate)).length),
    completed: delta(projects.filter((p) => p.completedAt && cur(p.completedAt)).length, projects.filter((p) => p.completedAt && prev(p.completedAt)).length),
    milestonesOnTime: rateDelta(rate(onTime(dueNow), dueNow.length), rate(onTime(duePrev), duePrev.length)),
    milestonesDue: dueNow.length,
    trend: series(projects.filter((p) => p.completedAt), (p) => k(p.completedAt!), b),
  };

  // ---- Team -----------------------------------------------------------------------------
  const team = await teamSection(principal, b, tz, now);

  return { period, bounds: b, leads, outreach, revenue, projects: projectsSection, team };
}

async function teamSection(principal: Principal, b: Bounds, tz: string, now: Date) {
  const members = (await directoryFor(principal)).filter((m) => m.employmentStatus !== "INACTIVE");
  const humans = members.filter((m) => !m.isAgent);
  const start = (key: string) => startOfCompanyDay(new Date(`${key}T12:00:00Z`), tz);
  const [perfNow, perfPrev] = await Promise.all([
    performanceFor(members, start(b.from), start(addDays(b.to, 1)), now),
    performanceFor(members, start(b.prevFrom), start(addDays(b.prevTo, 1)), now),
  ]);
  const total = (m: Map<string, { tasksCompleted: number; completedOnTime: number; completedWithDeadline: number; tasksOverdue: number }>) => {
    let completed = 0, onTime = 0, withDeadline = 0, overdue = 0;
    for (const p of m.values()) {
      completed += p.tasksCompleted;
      onTime += p.completedOnTime;
      withDeadline += p.completedWithDeadline;
      overdue += p.tasksOverdue;
    }
    return { completed, onTime, withDeadline, overdue };
  };
  const a = total(perfNow);
  const p = total(perfPrev);

  // Attendance is monthly on the company calendar: this month against last month.
  const thisMonth = b.to.slice(0, 7);
  const lastMonth = (() => {
    const [y, m] = thisMonth.split("-").map(Number);
    return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  })();
  const [attNow, attPrev] = await Promise.all([attendanceFor(humans, thisMonth, now), attendanceFor(humans, lastMonth, now)]);
  const pooled = (views: Awaited<ReturnType<typeof attendanceFor>>) => {
    let present = 0, expected = 0;
    for (const v of views.values()) {
      for (const d of v.days) {
        if (d.status === "PRESENT" || d.status === "LATE" || d.status === "IN_PROGRESS") present += 1;
        if (d.scheduled && d.status !== "UPCOMING" && d.status !== "ON_LEAVE") expected += 1;
      }
    }
    return rate(present, expected);
  };

  return {
    people: humans.length,
    tasksCompleted: delta(a.completed, p.completed),
    onTimeRate: rateDelta(rate(a.onTime, a.withDeadline), rate(p.onTime, p.withDeadline)),
    overdueNow: a.overdue,
    attendance: { month: thisMonth, ...rateDelta(pooled(attNow), pooled(attPrev)) },
    top: members
      .map((m) => ({ id: m.id, name: m.name, avatarColor: m.avatarColor, completed: perfNow.get(m.id)?.tasksCompleted ?? 0, onTimeRate: perfNow.get(m.id)?.onTimeRate ?? null }))
      .filter((m) => m.completed > 0)
      .sort((x, y) => y.completed - x.completed)
      .slice(0, 5),
  };
}

function sourceLabel(source: string): string {
  return (LEAD_SOURCE_LABEL as Record<string, string>)[source] ?? source.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export type CommandCenter = Awaited<ReturnType<typeof commandCenter>>;

/** Warms the standard periods (the morning job), so the first look of the day is instant. */
export async function warmCommandCenter(now = new Date()) {
  const founders = await prisma.user.findMany({ where: { isActive: true, role: { in: ["FOUNDER", "ADMIN"] }, organizationId: { not: null } }, distinct: ["organizationId"], select: { id: true } });
  let warmed = 0;
  for (const f of founders) {
    const { principalFor } = await import("@/modules/rbac/server");
    const principal = await principalFor({ id: f.id });
    if (!principal) continue;
    for (const period of ["30d", "month"] as const) {
      await commandCenter(principal, period, now);
      warmed += 1;
    }
  }
  return { warmed };
}

/** Client retention for a period (the analytics hub). */
export async function retention(organizationId: string, period: Period, now = new Date()) {
  const tz = await companyTimezone();
  const b = periodBounds(period, dayKey(now, tz));
  const clients = await prisma.client.findMany({ where: { organizationId }, select: { id: true, businessName: true, status: true, onboardedAt: true, createdAt: true, churnedAt: true } });
  const rows = clients.map((c) => ({ id: c.id, name: c.businessName, status: c.status, startKey: dayKey(c.onboardedAt ?? c.createdAt, tz), churnKey: c.churnedAt ? dayKey(c.churnedAt, tz) : null }));
  const prevRows = retentionOf(rows, b.prevFrom, b.prevTo);
  const current = retentionOf(rows, b.from, b.to);
  return { bounds: b, ...current, retentionDelta: rateDelta(current.retentionRate, prevRows.retentionRate), addedDelta: delta(current.added, prevRows.added), churnedDelta: delta(current.churned.length, prevRows.churned.length) };
}

/** Outstanding payments by age (the analytics hub). */
export async function receivables(organizationId: string, now = new Date()) {
  const tz = await companyTimezone();
  const today = dayKey(now, tz);
  const [org, invoices] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { currency: true } }),
    prisma.invoice.findMany({ where: { organizationId, status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] } }, select: { clientId: true, currency: true, dueDate: true, totalMinor: true, paidMinor: true, status: true, client: { select: { businessName: true } } } }),
  ]);
  const mine = invoices.filter((i) => i.currency === org.currency);
  return {
    currency: org.currency,
    todayKey: today,
    otherCurrency: invoices.length - mine.length,
    ...agingOf(mine.map((i) => ({ clientId: i.clientId, clientName: i.client.businessName, dueKey: i.dueDate.toISOString().slice(0, 10), balanceMinor: balanceOf(i) })), today),
  };
}
