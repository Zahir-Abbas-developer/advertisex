import { z } from "zod";

import { defineCapability } from "@/modules/ai/agents/capability";
import { parseJson } from "@/modules/ai/agents/capabilities/json";

const Answer = z.object({ channel: z.enum(["EMAIL", "CALL", "MESSAGE"]).default("EMAIL"), subject: z.string().max(120).optional(), body: z.string().min(40).max(1200) });

/**
 * Follow-up Preparation: drafts the next touch for a lead and hands it to the
 * lead's owner as a task — the agent never contacts a prospect itself.
 */
export default defineCapability({
  key: "follow-up-prep",
  name: "Follow-up Preparation",
  description: "Drafts the next touch for a lead and gives it to the owner as a task, ready to send.",
  subjectType: "lead",
  tools: ["leads.read", "tasks.create", "leads.addNote"],
  defaults: { maxRunsPerHour: 40, monthlyBudgetMicros: 2_000_000 },
  async run(ctx) {
    const lead = await ctx.tools["leads.read"]({ leadId: ctx.run.subjectId! });
    const last = lead.recent.find((a) => a.type !== "NOTE");
    const ai = parseJson(
      await ctx.ask({
        task: "follow-up",
        system: "You draft a short, warm follow-up from a restaurant-marketing agency to a prospect. No hype, no invented facts or numbers, one concrete idea, one clear ask. Reply with JSON only: {\"channel\": \"EMAIL\"|\"CALL\"|\"MESSAGE\", \"subject\": string, \"body\": string}.",
        prompt: JSON.stringify({ business: lead.businessName, firstName: lead.contactFirstName, stage: lead.stageLabel, interestedIn: lead.interestedServices, lastTouch: last ?? null, notes: lead.notes }),
        maxTokens: 400,
      }),
      Answer,
    );
    const draft = ai ?? {
      channel: "EMAIL" as const,
      subject: `Following up — ${lead.businessName}`,
      body: `Hi ${lead.contactFirstName},\n\nFollowing up on ${last ? `our last ${last.type.toLowerCase().replace(/_/g, " ")}` : "our conversation"}. We've been thinking about ${lead.interestedServices ? lead.interestedServices.split(",")[0].toLowerCase() : "how to bring in more guests"} for ${lead.businessName} and have one idea we'd like to show you. Would a 20-minute call this week work?\n\nBest,`,
    };
    const task = await ctx.tools["tasks.create"]({
      leadId: lead.id,
      assigneeId: lead.ownerId ?? (ctx.run.input.requestedById as string | undefined) ?? null,
      title: `Send follow-up to ${lead.businessName}`,
      note: `Drafted by ${ctx.agent.name}${ai ? " (AI)" : ""} — review before sending.\n\n${draft.subject ? `Subject: ${draft.subject}\n\n` : ""}${draft.body}`,
      dueInDays: 1,
    });
    await ctx.tools["leads.addNote"]({ leadId: lead.id, note: `${ctx.agent.name} drafted a follow-up (${draft.channel.toLowerCase()}) and created a task for the owner.` });
    return { summary: `${lead.businessName}: follow-up drafted`, data: { taskId: task.taskId, channel: draft.channel, draftBy: ai ? "AI" : "RULES" } };
  },
});
