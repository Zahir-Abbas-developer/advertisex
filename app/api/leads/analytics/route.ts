import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { companyTimezone } from "@/lib/company-time";
import { rangeFromQuery } from "@/lib/date";
import { requireApi } from "@/modules/rbac/server";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, stageVelocity } from "@/modules/leads/domain";
import { bucketOf, OUTREACH_ACTIVITY_TYPES, rollup } from "@/modules/outreach/domain";

/**
 * Founder leads analytics (Phase 3 scope 6). Formulas: docs/METRICS.md.
 * Founder: every department; manager: their departments.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "lead");
  if (access.response) return access.response;
  const principal = access.principal;
  if (principal.role !== "FOUNDER" && principal.role !== "MANAGER") {
    return NextResponse.json({ error: "Leads analytics is for the founder and managers" }, { status: 403 });
  }

  const url = new URL(request.url);
  const timeZone = await companyTimezone();
  const range = rangeFromQuery(url.searchParams, 90, 3 * 366, timeZone);
  if (!range) return NextResponse.json({ error: "Pick a date range of at most three years" }, { status: 422 });
  const { from, to } = range;
  const departmentId = url.searchParams.get("departmentId");

  const scope =
    principal.role === "FOUNDER"
      ? departmentId ? { departmentId } : {}
      : { departmentId: departmentId && principal.departmentIds.includes(departmentId) ? departmentId : { in: [...principal.departmentIds] } };

  const [stages, leads, events, outreach] = await Promise.all([
    prisma.pipelineStage.findMany({ select: { departmentId: true, key: true, label: true, kind: true } }),
    prisma.lead.findMany({
      where: scope,
      select: { id: true, departmentId: true, stage: true, source: true, dealValue: true, createdAt: true, convertedAt: true, stageChangedAt: true },
    }),
    prisma.leadStageEvent.findMany({
      where: scope,
      select: { leadId: true, departmentId: true, toStage: true, at: true },
      orderBy: { at: "asc" },
    }),
    prisma.salesActivity.findMany({
      where: { ...scope, occurredAt: { gte: from, lte: to }, type: { in: OUTREACH_ACTIVITY_TYPES } },
      select: { type: true, occurredAt: true, userId: true },
    }),
  ]);

  const kindOf = (dept: string, key: string) => stages.find((s) => s.departmentId === dept && s.key === key)?.kind ?? "OPEN";
  const inRange = (d: Date | null) => Boolean(d && d >= from && d <= to);
  const entered = (key: string) =>
    new Set(events.filter((e) => e.toStage === key && inRange(e.at)).map((e) => e.leadId)).size;
  const lostInRange = new Set(events.filter((e) => kindOf(e.departmentId, e.toStage) === "LOST" && inRange(e.at)).map((e) => e.leadId)).size;
  const convertedInRange = leads.filter((l) => inRange(l.convertedAt)).length;
  const counts = rollup(outreach, "month", timeZone).total;

  const bySource = LEAD_SOURCES.map((source) => {
    const created = leads.filter((l) => l.source === source && inRange(l.createdAt));
    return {
      source,
      label: LEAD_SOURCE_LABEL[source],
      created: created.length,
      converted: leads.filter((l) => l.source === source && inRange(l.convertedAt)).length,
    };
  }).filter((row) => row.created > 0 || row.converted > 0);

  // Weekly trend over the range: new leads vs deals won, company calendar.
  const weeks = new Map<string, { week: string; created: number; won: number }>();
  const week = (d: Date) => bucketOf(d, "week", timeZone);
  const weekRow = (key: string) => {
    const row = weeks.get(key) ?? { week: key, created: 0, won: 0 };
    weeks.set(key, row);
    return row;
  };
  // Every week in the range appears, even an empty one — a gap in a trend
  // line reads as missing data, a zero reads as a quiet week.
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) weekRow(week(new Date(t)));
  for (const l of leads) {
    if (inRange(l.createdAt)) weekRow(week(l.createdAt)).created += 1;
    if (inRange(l.convertedAt)) weekRow(week(l.convertedAt!)).won += 1;
  }

  const labelOf = (key: string) => stages.find((s) => s.key === key)?.label ?? key;
  const funnelKeys = ["NEW_LEAD", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL", "NEGOTIATION", "WON"];

  return NextResponse.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      total: leads.length,
      new: leads.filter((l) => inRange(l.createdAt)).length,
      contacted: entered("CONTACTED"),
      qualified: entered("QUALIFIED"),
      followUps: counts.followUps,
      meetingsBooked: counts.meetingsBooked,
      converted: convertedInRange,
      lost: lostInRange,
      conversionRate: convertedInRange + lostInRange > 0 ? convertedInRange / (convertedInRange + lostInRange) : null,
      pipelineValue: leads.filter((l) => kindOf(l.departmentId, l.stage) === "OPEN").reduce((t, l) => t + l.dealValue, 0),
      openLeads: leads.filter((l) => kindOf(l.departmentId, l.stage) === "OPEN").length,
    },
    bySource,
    funnel: funnelKeys.map((key) => ({ stage: key, label: labelOf(key), entered: entered(key) })),
    velocity: stageVelocity(events)
      .filter((v) => funnelKeys.includes(v.stage) && v.stage !== "WON")
      .sort((a, b) => funnelKeys.indexOf(a.stage) - funnelKeys.indexOf(b.stage))
      .map((v) => ({ ...v, label: labelOf(v.stage) })),
    trend: [...weeks.values()].sort((a, b) => (a.week < b.week ? -1 : 1)),
  });
}
