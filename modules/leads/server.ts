import type { Prisma } from "@prisma/client";

import { parseTags, filtersToWhere, parseFilters, type LeadFilters } from "@/modules/leads/domain";
import type { LeadSource } from "@/lib/serializers/lead";

/**
 * Shared lead reads for the board, the table and the export — one include,
 * one mapping, one way to turn untrusted filters into a query, so the three
 * views can never disagree about which leads match.
 */

export const LEAD_INCLUDE = {
  owner: { select: { id: true, name: true, avatarColor: true } },
  _count: { select: { activities: true } },
} satisfies Prisma.LeadInclude;

type LeadRow = Prisma.LeadGetPayload<{ include: typeof LEAD_INCLUDE }>;

export function toLeadSource(lead: LeadRow): LeadSource {
  return {
    id: lead.id,
    businessName: lead.businessName,
    contactName: lead.contactName,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    sourceDetail: lead.sourceDetail,
    country: lead.country,
    location: lead.location,
    website: lead.website,
    industry: lead.industry,
    tags: parseTags(lead.tags),
    interestedServices: lead.interestedServices.split(",").map((s) => s.trim()).filter(Boolean),
    estimatedMonthlyValue: lead.estimatedMonthlyValue,
    dealValue: lead.dealValue,
    ownerId: lead.ownerId,
    stage: lead.stage,
    stageChangedAt: lead.stageChangedAt,
    lostReason: lead.lostReason,
    lostNote: lead.lostNote,
    owner: lead.owner,
    activityCount: lead._count.activities,
    convertedClientId: lead.convertedClientId,
    createdAt: lead.createdAt,
  };
}

/**
 * Filters from a request (`?f=<json>`), made safe for this viewer: invalid
 * input is dropped, and value filters are ignored for anyone who may not see
 * deal values — a value filter would let them work the values out by trial.
 */
export function filtersFromRequest(url: URL, canSeeValues: boolean): LeadFilters {
  let raw: unknown = {};
  const f = url.searchParams.get("f");
  if (f) {
    try {
      raw = JSON.parse(f);
    } catch {
      raw = {};
    }
  }
  const filters = parseFilters(raw);
  if (!canSeeValues) {
    delete filters.minValue;
    delete filters.maxValue;
  }
  return filters;
}

export function whereFor(filters: LeadFilters, departmentIds: readonly string[] | null): Prisma.LeadWhereInput {
  const scoped: Prisma.LeadWhereInput = departmentIds ? { departmentId: { in: [...departmentIds] } } : {};
  return { AND: [scoped, filtersToWhere(filters) as Prisma.LeadWhereInput] };
}
