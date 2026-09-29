import { defineCapability } from "@/modules/ai/agents/capability";

const lastMonth = () => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};

/**
 * Client Report Drafting (the Phase 8 hook): drafts a client's monthly report
 * and proposes publishing it. Publishing reaches the client, so it is an
 * approval, decided in the review queue.
 */
export default defineCapability({
  key: "report-drafting",
  name: "Client Report Drafting",
  description: "Drafts a client's monthly report from its results and progress, and puts it up for approval.",
  subjectType: "client",
  tools: ["reports.draft", "reports.proposePublish"],
  defaults: { maxRunsPerHour: 20, monthlyBudgetMicros: 3_000_000 },
  async run(ctx) {
    const month = typeof ctx.run.input.month === "string" ? ctx.run.input.month : lastMonth();
    const draft = await ctx.tools["reports.draft"]({ clientId: ctx.run.subjectId!, month });
    const proposal = await ctx.tools["reports.proposePublish"]({ reportId: draft.reportId });
    return { summary: `${month} report drafted${"approvalId" in proposal ? " — awaiting approval to publish" : ""}`, data: { reportId: draft.reportId, month, ...proposal } };
  },
});
