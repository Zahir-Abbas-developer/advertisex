import { z } from "zod";

/**
 * Lead pipeline rules (Phase 3) — pure, unit-tested (tests/leads-domain.test.ts),
 * formulas in docs/METRICS.md.
 */

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/**
 * The standard pipeline every department starts with (Phase 3 scope 2).
 * Departments still own their stages (config lives in the database — BWM
 * doctrine, kept); this is the template new departments and fresh databases
 * get, and what the founder's pipeline reads as by default.
 */
export const STANDARD_STAGES = [
  { key: "NEW_LEAD", label: "New lead", kind: "OPEN", colorToken: "neutral" },
  { key: "CONTACTED", label: "Contacted", kind: "OPEN", colorToken: "info" },
  { key: "QUALIFIED", label: "Qualified", kind: "OPEN", colorToken: "info" },
  { key: "MEETING", label: "Meeting", kind: "OPEN", colorToken: "warning" },
  { key: "PROPOSAL", label: "Proposal", kind: "OPEN", colorToken: "warning" },
  { key: "NEGOTIATION", label: "Negotiation", kind: "OPEN", colorToken: "warning" },
  { key: "WON", label: "Won", kind: "WON", colorToken: "success" },
  { key: "LOST", label: "Lost", kind: "LOST", colorToken: "danger" },
] as const;

// ---------------------------------------------------------------------------
// Sources, industries, tags
// ---------------------------------------------------------------------------

export const LEAD_SOURCES = [
  "OUTREACH",
  "REFERRAL",
  "INBOUND",
  "SOCIAL",
  "WEBSITE",
  "PAID_ADS",
  "EVENT",
  "OTHER",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  OUTREACH: "Cold outreach",
  REFERRAL: "Referral",
  INBOUND: "Inbound enquiry",
  SOCIAL: "Social media",
  WEBSITE: "Website",
  PAID_ADS: "Paid ads",
  EVENT: "Event",
  OTHER: "Other",
};

/** Restaurant and food segments — defaults, not a closed list. */
export const INDUSTRY_SEGMENTS = [
  "Restaurant",
  "Fine dining",
  "Fast casual",
  "Quick service",
  "Café",
  "Bar & pub",
  "Bakery",
  "Food truck",
  "Ghost kitchen",
  "Catering",
  "Franchise group",
  "Food & beverage brand",
] as const;

/** " Brunch, VIP ,,brunch " → ["brunch", "vip"] — lower-case, trimmed, unique. */
export function parseTags(stored: string | null | undefined): string[] {
  if (!stored) return [];
  return [...new Set(stored.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

export function serializeTags(tags: readonly string[]): string {
  return parseTags(tags.join(",")).join(",");
}

// ---------------------------------------------------------------------------
// Filters — one shape for the board, the table, saved views and export
// ---------------------------------------------------------------------------

export const leadFiltersSchema = z
  .object({
    departmentId: z.string().min(1).optional(),
    stages: z.array(z.string().min(1)).max(20).optional(),
    sources: z.array(z.enum(LEAD_SOURCES)).max(LEAD_SOURCES.length).optional(),
    ownerId: z.string().min(1).optional(),
    minValue: z.number().int().min(0).optional(),
    maxValue: z.number().int().min(0).optional(),
    /** YYYY-MM-DD, inclusive, on created date. */
    createdFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    createdTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    tag: z.string().trim().toLowerCase().min(1).max(40).optional(),
    q: z.string().trim().max(120).optional(),
  })
  .strict();
export type LeadFilters = z.infer<typeof leadFiltersSchema>;

/** Filters read from anywhere untrusted (a saved view, a URL) — invalid → none. */
export function parseFilters(raw: unknown): LeadFilters {
  const parsed = leadFiltersSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/**
 * The Prisma `where` for a set of filters. Pure: callers add department
 * scope and the data layer adds the organization.
 */
export function filtersToWhere(f: LeadFilters): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];
  if (f.departmentId) and.push({ departmentId: f.departmentId });
  if (f.stages?.length) and.push({ stage: { in: f.stages } });
  if (f.sources?.length) and.push({ source: { in: f.sources } });
  if (f.ownerId) and.push({ ownerId: f.ownerId === "none" ? null : f.ownerId });
  if (f.minValue !== undefined) and.push({ dealValue: { gte: f.minValue } });
  if (f.maxValue !== undefined) and.push({ dealValue: { lte: f.maxValue } });
  if (f.createdFrom) and.push({ createdAt: { gte: new Date(`${f.createdFrom}T00:00:00.000Z`) } });
  if (f.createdTo) and.push({ createdAt: { lt: new Date(new Date(`${f.createdTo}T00:00:00.000Z`).getTime() + 86_400_000) } });
  if (f.tag) and.push({ tags: { contains: f.tag } });
  if (f.q) {
    and.push({
      OR: [
        { businessName: { contains: f.q } },
        { contactName: { contains: f.q } },
        { email: { contains: f.q } },
        { location: { contains: f.q } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

// ---------------------------------------------------------------------------
// Stage velocity
// ---------------------------------------------------------------------------

export type StageEvent = { leadId: string; toStage: string; at: Date };

/**
 * Average days a lead spends in each stage before leaving it, from the stage
 * history. Only completed stays count — a lead still sitting in a stage has
 * not told us how long that stage takes yet — so each sample is the time
 * between entering a stage and the next move.
 */
export function stageVelocity(events: readonly StageEvent[]): { stage: string; avgDays: number; samples: number }[] {
  const byLead = new Map<string, StageEvent[]>();
  for (const e of events) {
    const list = byLead.get(e.leadId) ?? [];
    list.push(e);
    byLead.set(e.leadId, list);
  }
  const totals = new Map<string, { ms: number; n: number }>();
  for (const list of byLead.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let i = 0; i < list.length - 1; i++) {
      const stay = list[i + 1].at.getTime() - list[i].at.getTime();
      const t = totals.get(list[i].toStage) ?? { ms: 0, n: 0 };
      t.ms += Math.max(0, stay);
      t.n += 1;
      totals.set(list[i].toStage, t);
    }
  }
  return [...totals.entries()].map(([stage, t]) => ({
    stage,
    avgDays: Math.round((t.ms / t.n / 86_400_000) * 10) / 10,
    samples: t.n,
  }));
}
