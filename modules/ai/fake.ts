import type { AiProvider, CompletionRequest, CompletionResult } from "@/modules/ai/provider";

/**
 * A deterministic stand-in model for development and the test suites
 * (AI_PROVIDER=fake; refused in production — modules/ai/index.ts). It answers
 * a known task marker in the system prompt with fixed, valid output, and
 * reports token usage as ~4 characters per token, so the agent pipeline —
 * validation, costs, budgets — runs exactly as it would against a real model.
 */
export function fakeProvider(): AiProvider {
  const answer = (req: CompletionRequest): string => {
    const task = /\[task:([a-z-]+)\]/.exec(req.system)?.[1];
    switch (task) {
      case "lead-qualification":
        return JSON.stringify({ score: 78, band: "HOT", rationale: "An established restaurant with a clear budget and an active interest in paid search; the owner replied within a day. Worth a call this week.", nextStep: "Book a 20-minute Appetite Audit call." });
      case "lead-research":
        return JSON.stringify({ summary: "A family-run Italian restaurant with online booking and a weekend brunch menu.", cuisine: "Italian", services: ["Dine-in", "Brunch", "Private events"], signals: ["Online booking", "Instagram active"], gaps: ["No Google Ads visible", "Menu is a PDF"] });
      case "follow-up":
        return JSON.stringify({ channel: "EMAIL", subject: "Your brunch bookings", body: "Hi — following up on our chat about weekend brunch. We put together two ideas to fill the 11am slot; happy to walk you through them this week. Would Thursday suit?" });
      case "task-creator":
        return JSON.stringify({ tasks: [{ title: "Collect brand assets from the client", days: 2 }, { title: "Draft the homepage wireframe", days: 5 }, { title: "Set up conversion tracking", days: 7 }] });
      case "internal-notifier":
        return "Pipeline this week: new leads are coming in steadily and three deals closed. Two invoices are overdue and one project is behind — worth a look this morning.";
      default:
        return "A short, factual summary.";
    }
  };
  const completeWithUsage = async (req: CompletionRequest): Promise<CompletionResult> => {
    const text = answer(req);
    return { text, model: "fake-model", inputTokens: Math.ceil((req.system.length + req.prompt.length) / 4), outputTokens: Math.ceil(text.length / 4) };
  };
  return { name: "fake", completeWithUsage, complete: async (req) => (await completeWithUsage(req)).text };
}
