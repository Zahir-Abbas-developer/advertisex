import { defineCapability } from "@/modules/ai/agents/capability";

/**
 * Internal Notifier: a short summary of what needs attention — new and won
 * deals, stale leads, overdue tasks, delayed projects — posted to the
 * founders (or whoever the rule names). Internal only.
 */
export default defineCapability({
  key: "internal-notifier",
  name: "Internal Notifier",
  description: "Posts a short internal summary of what needs attention: pipeline, overdue work, delayed projects.",
  subjectType: "organization",
  tools: ["pipeline.snapshot", "notify.team"],
  defaults: { maxRunsPerHour: 10, monthlyBudgetMicros: 1_000_000 },
  async run(ctx) {
    const s = await ctx.tools["pipeline.snapshot"]({});
    const text =
      (await ctx.ask({
        task: "internal-notifier",
        system: "You write a two-sentence internal status note for an agency founder. Use only the numbers given; plain words; say what deserves attention first.",
        prompt: JSON.stringify(s),
        maxTokens: 160,
      })) ??
      `This week: ${s.newLeads} new lead${s.newLeads === 1 ? "" : "s"} and ${s.won} deal${s.won === 1 ? "" : "s"} won. Needs attention: ${s.overdueTasks} overdue task${s.overdueTasks === 1 ? "" : "s"}, ${s.delayed} delayed project${s.delayed === 1 ? "" : "s"} and ${s.stale} lead${s.stale === 1 ? "" : "s"} idle for three weeks.`;
    // Whoever the run names; otherwise the tool's default, the founders.
    const userIds = Array.isArray(ctx.run.input.userIds) ? (ctx.run.input.userIds as string[]) : undefined;
    const out = await ctx.tools["notify.team"]({ userIds, title: "What needs attention", body: text.slice(0, 600) });
    return { summary: `Summary sent to ${out.sent}`, data: { ...s, sent: out.sent } };
  },
});
