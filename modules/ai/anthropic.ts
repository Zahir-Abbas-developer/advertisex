import { AiError, type AiProvider, type CompletionRequest, type CompletionResult } from "@/modules/ai/provider";
import { fetchWithRetry } from "@/lib/retry";

/**
 * Anthropic Messages API over fetch — no SDK dependency for one call.
 * Configured by ANTHROPIC_API_KEY and (optionally) AI_MODEL.
 */
export function anthropicProvider(apiKey: string, model: string): AiProvider {
  const completeWithUsage = async ({ system, prompt, maxTokens = 400, timeoutMs = 8000 }: CompletionRequest): Promise<CompletionResult> => {
    // Overloaded (529) and rate-limited (429) answers are retried with backoff;
    // a completion has no side effects, so a retry is always safe.
    const res = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }),
      },
      { timeoutMs, attempts: 2 },
    );
    if (!res.ok) throw new AiError(`AI provider returned ${res.status}`);
    const body = (await res.json()) as { model?: string; content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    return {
      text: (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
      model: body.model ?? model,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    };
  };
  return {
    name: `anthropic:${model}`,
    completeWithUsage,
    async complete(request) {
      return (await completeWithUsage(request)).text;
    },
  };
}
