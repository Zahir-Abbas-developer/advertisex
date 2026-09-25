import { normalizeRole } from "@/config/permissions";

/**
 * Who may change what on a lead.
 *
 * Two questions with two different answers, kept apart on purpose:
 *
 * - **Editing the details** — the business, the contact, the notes, the
 *   department's own questions — is open to an admin, to the lead's owner, and
 *   to whoever filed it. The last one is new, and necessary: automatic routing
 *   hands most new leads to someone other than the person who typed them in,
 *   so "owner only" meant the author of a lead could not fix a typo they had
 *   made a minute earlier.
 * - **Moving the deal or reassigning it** stays with the owner and the admins.
 *   Stages drive scoring and payouts, and reassignment decides whose pipeline a
 *   deal counts towards; neither is a correction to what was typed.
 *
 * Department membership is checked separately by every caller — this answers
 * "which of the people allowed to see it may change it", nothing more.
 */

type Actor = { id: string; role: string };
type LeadRef = { ownerId: string | null; createdById?: string | null };

/**
 * FOUNDER and MANAGER hold `lead:update` over every lead they can see (the
 * matrix scopes a MANAGER to their departments; callers have already applied
 * that). EMPLOYEE authority is per lead, below.
 */
function managesLeads(role: string): boolean {
  const normalized = normalizeRole(role);
  return normalized === "FOUNDER" || normalized === "MANAGER";
}

export function canEditLeadDetails(actor: Actor, lead: LeadRef): boolean {
  if (managesLeads(actor.role)) return true;
  if (lead.ownerId === actor.id) return true;
  return Boolean(lead.createdById) && lead.createdById === actor.id;
}

export function canMoveLead(actor: Actor, lead: LeadRef): boolean {
  return managesLeads(actor.role) || lead.ownerId === actor.id;
}
