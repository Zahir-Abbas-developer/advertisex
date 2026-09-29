import { z } from "zod";

import { defineCapability } from "@/modules/ai/agents/capability";
import { parseJson } from "@/modules/ai/agents/capabilities/json";

const Answer = z.object({ body: z.string().min(40).max(1200) });

/**
 * Client Check-in: a short progress note to the client about one project —
 * what's done, what's next — proposed as a message. Reaching a client is
 * consequential, so a person approves it, and it is sent in their name.
 *
 * Added after the framework (Phase 9 acceptance: a new agent is a new
 * capability definition — this file and one line in registry.ts; no schema,
 * no tools, no routes, no UI).
 */
export default defineCapability({
  key: "client-check-in",
  name: "Client Check-in",
  description: "Drafts a short progress update to the client about a project, for a person to approve and send.",
  subjectType: "project",
  tools: ["projects.read", "messages.proposeToClient"],
  defaults: { maxRunsPerHour: 20, monthlyBudgetMicros: 1_000_000 },
  async run(ctx) {
    const p = await ctx.tools["projects.read"]({ projectId: ctx.run.subjectId! });
    const done = p.stages.filter((s) => s.status === "DONE").map((s) => s.name);
    const next = p.stages.find((s) => s.status !== "DONE")?.name ?? null;
    const ai = parseJson(
      await ctx.ask({
        task: "client-check-in",
        system: 'You write a warm, three-sentence progress update from a marketing agency to a restaurant client. Plain words, no jargon, no invented facts or dates. Reply with JSON only: {"body": string}.',
        prompt: JSON.stringify({ project: p.title, client: p.client, done, next }),
        maxTokens: 300,
      }),
      Answer,
    );
    const body =
      ai?.body ??
      `Hi ${p.client} team — a quick update on ${p.title}. ${done.length ? `We've finished ${done.join(", ").toLowerCase()}.` : "We're under way."} ${next ? `Next up is ${next.toLowerCase()}; we'll share it with you as soon as it's ready.` : "Everything planned is done — we'll be in touch about what's next."} Any questions, just reply here.`;
    const proposal = await ctx.tools["messages.proposeToClient"]({ clientId: p.clientId, body });
    return { summary: `${p.title}: check-in drafted — awaiting approval to send`, data: { approvalId: proposal.approvalId, draftBy: ai ? "AI" : "RULES" } };
  },
});
