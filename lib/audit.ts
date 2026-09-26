import { prisma } from "@/lib/prisma";

/**
 * The record of who exercised authority.
 *
 * Distinct from `lib/activity.ts`, and the distinction matters. Activity is a
 * milestone's story, written for the team and rendered in a feed: "Tayyaba
 * moved Campaign launch to Submitted". This is written for the person asking
 * "who did that, and what was it before?" — score adjustments, dispute
 * rulings, role changes, settings edits, excusals.
 *
 * Never throws into its caller. An audit write failing must not roll back the
 * decision it was recording; a missing line is recoverable, a half-applied
 * approval is not. Failures go to the server log where they are visible.
 */

export { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, type AuditAction } from "@/lib/audit-actions";
import type { AuditAction } from "@/lib/audit-actions";

export type AuditInput = {
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  /** Only the fields that changed — a whole-row dump is unreadable at review time. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** True when the actor was acting as a Service Lead rather than the owner. */
  asLead?: boolean;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        beforeJson: input.before ? JSON.stringify(input.before) : null,
        afterJson: input.after ? JSON.stringify(input.after) : null,
        asLead: Boolean(input.asLead),
      },
    });
  } catch (error) {
    console.error("audit write failed", input.action, error);
  }
}

/**
 * Only the keys that actually changed.
 *
 * Storing a whole row before and after makes the log technically complete and
 * practically unreadable — the reviewer has to diff two blobs by eye to find
 * the one field that moved.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    changedBefore[key] = before[key];
    changedAfter[key] = after[key];
  }

  return Object.keys(changedAfter).length === 0
    ? null
    : { before: changedBefore, after: changedAfter };
}
