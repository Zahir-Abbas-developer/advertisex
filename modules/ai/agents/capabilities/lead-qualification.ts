import { z } from "zod";

import { defineCapability } from "@/modules/ai/agents/capability";
import { nextStepFor, qualify, ruleRationale } from "@/modules/ai/agents/scoring";
import { parseJson } from "@/modules/ai/agents/capabilities/json";

const Answer = z.object({ rationale: z.string().min(20).max(600), nextStep: z.string().min(5).max(200) });

/**
 * Lead Qualification: a 0–100 score with a rationale, on the lead's timeline.
 * The score is computed from recorded facts (scoring.ts) so it is repeatable;
 * a model, when available, writes the rationale and next step around it.
 * A cold lead that has gone quiet for STALE_DAYS is proposed as lost (no
 * response) — a person decides; the agent never moves a deal itself.
 */
const STALE_DAYS = 45;
export default defineCapability({
  key: "lead-qualification",
  name: "Lead Qualification",
  description: "Scores a lead 0–100 from budget, source, engagement, fit and momentum, and explains why.",
  subjectType: "lead",
  tools: ["leads.read", "leads.addNote", "leads.tag", "leads.proposeOutcome"],
  defaults: { maxRunsPerHour: 60, monthlyBudgetMicros: 2_000_000 },
  async run(ctx) {
    const lead = await ctx.tools["leads.read"]({ leadId: ctx.run.subjectId! });
    const month = lead.recent.filter((a) => Date.now() - new Date(a.at).getTime() <= 30 * 86_400_000);
    const facts = {
      estimatedMonthlyValue: lead.estimatedMonthlyValue,
      dealValue: lead.dealValue,
      source: lead.source,
      industry: lead.industry,
      interestedServices: lead.interestedServices ? lead.interestedServices.split(",").filter(Boolean) : [],
      replies: month.filter((a) => a.type === "EMAIL_REPLY").length,
      meetings: month.filter((a) => ["MEETING_BOOKED", "MEETING_HELD", "MEETING"].includes(a.type)).length,
      touches: month.filter((a) => !["NOTE", "STATUS_CHANGE", "ASSIGNMENT"].includes(a.type)).length,
      daysSinceCreated: Math.floor((Date.now() - new Date(lead.createdAt).getTime()) / 86_400_000),
      daysSinceLastActivity: lead.recent[0] ? Math.floor((Date.now() - new Date(lead.recent[0].at).getTime()) / 86_400_000) : null,
      hasWebsite: Boolean(lead.website),
    };
    const q = qualify(facts);
    const ai = parseJson(
      await ctx.ask({
        task: "lead-qualification",
        system: "You explain a lead score to a restaurant-marketing agency's sales team. The score is already computed; do not change it. Reply with JSON only: {\"rationale\": string (2–3 sentences, plain English), \"nextStep\": string (one concrete action)}.",
        prompt: JSON.stringify({ business: lead.businessName, industry: lead.industry, stage: lead.stageLabel, score: q.score, band: q.band, factors: q.factors, facts }),
        maxTokens: 300,
      }),
      Answer,
    );
    const rationale = ai?.rationale ?? ruleRationale(q, facts);
    const nextStep = ai?.nextStep ?? nextStepFor(q.band);
    const breakdown = q.factors.map((f) => `${f.label} ${f.points}/${f.max}`).join(" · ");
    await ctx.tools["leads.addNote"]({ leadId: lead.id, note: `Qualification: ${q.score}/100 (${q.band.toLowerCase()}).\nWhy: ${rationale}\nNext step: ${nextStep}\nScore: ${breakdown}` });
    await ctx.tools["leads.tag"]({ leadId: lead.id, tags: [`fit:${q.band.toLowerCase()}`] });
    const idle = facts.daysSinceLastActivity ?? facts.daysSinceCreated;
    const lost = lead.outcomeStages.find((s) => s.kind === "LOST");
    let proposal: string | null = null;
    if (q.band === "COLD" && idle >= STALE_DAYS && lead.stageKind !== "WON" && lead.stageKind !== "LOST" && lost) {
      const p = await ctx.tools["leads.proposeOutcome"]({ leadId: lead.id, toStageKey: lost.key, lostReason: "NO_RESPONSE", reason: `cold (${q.score}/100) and no activity for ${idle} days` });
      proposal = p.approvalId;
    }
    return { summary: `${lead.businessName}: ${q.score}/100 (${q.band.toLowerCase()})${proposal ? " — proposed closing as lost" : ""}`, data: { score: q.score, band: q.band, factors: q.factors, rationale, nextStep, rationaleBy: ai ? "AI" : "RULES", proposedLost: proposal } };
  },
});
