import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

import { prisma, transaction } from "@/lib/prisma";
import { avatarColorFor } from "@/lib/constants";
import { stagesFor } from "@/lib/stages";
import type { Principal } from "@/modules/rbac/authorize";
import { servicesForPlan, writePlan } from "@/modules/projects/server";

/**
 * Convert a lead into a client — Phase 3 scope 7, in ONE transaction:
 *
 *   1. a ClientAccount (the restaurant's portal tenant),
 *   2. a Client carrying every field the lead had (contact, website, location,
 *      industry, tags, notes, budget, owner, follow-up) and its department
 *      answers copied to the client's matching questions,
 *   3. the first Project with the selected services,
 *   4. the lead's history (activities, tasks) linked to the client,
 *   5. the lead marked Won, with its stage history and "deal closed" entry,
 *   6. optionally, a client login (temporary password, forced change),
 *   7. an explicit LEAD_CONVERTED audit entry (the data layer also records
 *      every row it wrote).
 *
 * Either all of it happens or none of it does. Nothing is typed twice.
 */

export class ConvertError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export type ConvertInput = {
  serviceIds: string[];
  projectTitle?: string;
  /** YYYY-MM-DD. Defaults: today → +90 days (one growth sprint). */
  startDate?: string;
  endDate?: string;
  monthlyBudget?: number;
  invite?: { name: string; email: string } | null;
};

export type ConvertResult = {
  clientId: string;
  clientAccountId: string;
  projectId: string;
  invitedUser: { email: string; temporaryPassword: string } | null;
};

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

export async function convertLead(principal: Principal, leadId: string, input: ConvertInput): Promise<ConvertResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: { department: { select: { id: true, organizationId: true } } },
  });
  if (!lead) throw new ConvertError("That lead no longer exists", 404);
  if (lead.convertedClientId) throw new ConvertError(`${lead.businessName} is already a client`, 409);

  const stages = await stagesFor(lead.departmentId);
  const current = stages.find((s) => s.key === lead.stage);
  if (current?.kind === "LOST") throw new ConvertError("Reopen a lost deal before converting it", 422, { stage: "This deal is marked lost" });
  const won = stages.find((s) => s.kind === "WON");
  if (!won) throw new ConvertError("This department's pipeline has no Won stage", 422);

  const organizationId = lead.department.organizationId ?? principal.organizationId;
  if (!organizationId) throw new ConvertError("This lead has no organization", 422);

  const services = await servicesForPlan(input.serviceIds);
  if (services.length !== new Set(input.serviceIds).size) {
    throw new ConvertError("Please fix the highlighted fields", 422, { serviceIds: "One of those services isn't available" });
  }

  const invite = input.invite ? { ...input.invite, email: input.invite.email.trim().toLowerCase() } : null;
  if (invite && (await prisma.user.findUnique({ where: { email: invite.email } }))) {
    throw new ConvertError("Please fix the highlighted fields", 409, { inviteEmail: "An account with that email already exists" });
  }

  const today = new Date().toISOString().slice(0, 10);
  const start = day(input.startDate ?? today);
  const end = input.endDate ? day(input.endDate) : new Date(start.getTime() + 90 * 86_400_000);
  if (end <= start) throw new ConvertError("Please fix the highlighted fields", 422, { endDate: "The project must end after it starts" });

  const temporaryPassword = invite ? randomBytes(9).toString("base64url") : null;
  const passwordHash = temporaryPassword ? await bcrypt.hash(temporaryPassword, 10) : null;

  // The lead's department answers, to copy onto the client's questions with
  // the same key — the department asks both, so nothing is asked twice.
  const [leadAnswers, clientDefinitions] = await Promise.all([
    prisma.fieldValue.findMany({
      where: { recordId: lead.id, definition: { entity: "LEAD" } },
      select: { value: true, definition: { select: { key: true } } },
    }),
    prisma.fieldDefinition.findMany({
      where: { departmentId: lead.departmentId, entity: "CLIENT", isActive: true },
      select: { id: true, key: true },
    }),
  ]);

  const now = new Date();
  const firstWin = !lead.convertedAt;

  const result = await transaction(async (tx) => {
    const account = await tx.clientAccount.create({ data: { organizationId, name: lead.businessName } });

    const client = await tx.client.create({
      data: {
        organizationId,
        clientAccountId: account.id,
        departmentId: lead.departmentId,
        businessName: lead.businessName,
        contactName: lead.contactName,
        email: lead.email ?? "",
        phone: lead.phone,
        country: lead.country,
        industry: lead.industry,
        website: lead.website,
        location: lead.location,
        tags: lead.tags,
        notes: lead.notes,
        monthlyBudget: input.monthlyBudget ?? (lead.estimatedMonthlyValue || lead.dealValue),
        status: "ACTIVE",
        assigneeId: lead.ownerId,
        nextFollowUpAt: lead.nextFollowUpAt,
      },
    });

    for (const answer of leadAnswers) {
      const target = clientDefinitions.find((d) => d.key === answer.definition.key);
      if (target && answer.value) {
        await tx.fieldValue.create({ data: { fieldDefinitionId: target.id, recordId: client.id, value: answer.value } });
      }
    }

    // The first project, planned from its services' stage templates (Phase 4),
    // run by whoever owned the deal.
    const project = await tx.project.create({
      data: {
        organizationId,
        clientId: client.id,
        title: input.projectTitle?.trim() || `${lead.businessName} — ${services[0]?.name ?? "Onboarding"}`,
        startDate: start,
        endDate: end,
        status: "PLANNING",
        ownerId: lead.ownerId,
      },
    });
    await writePlan(tx, project.id, services, now);
    if (lead.ownerId) {
      await tx.projectMember.create({ data: { projectId: project.id, userId: lead.ownerId, role: "LEAD" } });
    }

    // The lead's whole history now belongs to the client too (kept on the
    // lead as well), so the client's timeline starts with how it was won.
    await tx.salesActivity.updateMany({ where: { leadId: lead.id }, data: { clientId: client.id } });
    await tx.task.updateMany({ where: { leadId: lead.id }, data: { clientId: client.id } });

    await tx.lead.update({
      where: { id: lead.id },
      data: {
        stage: won.key,
        stageChangedAt: now,
        convertedClientId: client.id,
        lostReason: null,
        lostNote: null,
        ...(firstWin ? { convertedAt: now } : {}),
      },
    });
    if (lead.stage !== won.key) {
      await tx.leadStageEvent.create({
        data: { leadId: lead.id, departmentId: lead.departmentId, fromStage: lead.stage, toStage: won.key, userId: principal.id, at: now },
      });
    }
    await tx.salesActivity.create({
      data: {
        departmentId: lead.departmentId,
        leadId: lead.id,
        clientId: client.id,
        userId: principal.id,
        type: "STATUS_CHANGE",
        isSystem: true,
        note: `Converted to a client — project "${project.title}" opened`,
        occurredAt: now,
      },
    });
    if (firstWin) {
      await tx.salesActivity.create({
        data: {
          departmentId: lead.departmentId,
          leadId: lead.id,
          clientId: client.id,
          userId: lead.ownerId ?? principal.id,
          type: "DEAL_CLOSED",
          isSystem: true,
          note: `Won ${lead.businessName}`,
          occurredAt: now,
        },
      });
    }

    if (invite && passwordHash) {
      await tx.user.create({
        data: {
          organizationId,
          clientAccountId: account.id,
          name: invite.name,
          email: invite.email,
          passwordHash,
          role: "CLIENT",
          clientRole: "OWNER",
          jobTitle: "Owner",
          mustChangePassword: true,
          avatarColor: avatarColorFor(invite.name),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: principal.id,
        actorType: principal.role === "AI_AGENT" ? "AI" : "HUMAN",
        action: "LEAD_CONVERTED",
        entityType: "Lead",
        entityId: lead.id,
        summary: `Converted ${lead.businessName} into a client with project "${project.title}"`,
        afterJson: JSON.stringify({ clientId: client.id, clientAccountId: account.id, projectId: project.id, services: services.map((s) => s.name), invited: invite?.email ?? null }),
      },
    });

    return { clientId: client.id, clientAccountId: account.id, projectId: project.id };
  });

  return {
    ...result,
    invitedUser: invite && temporaryPassword ? { email: invite.email, temporaryPassword } : null,
  };
}
