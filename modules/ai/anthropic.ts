import { AiError, type AiProvider, type CompletionRequest } from "@/modules/ai/provider";

/**
 * Anthropic Messages API over fetch — no SDK dependency for one call.
 * Configured by ANTHROPIC_API_KEY and (optionally) AI_MODEL.
 */
export function anthropicProvider(apiKey: string, model: string): AiProvider {
  return {
    name: `anthropic:${model}`,
    async complete({ system, prompt, maxTokens = 400, timeoutMs = 8000 }: CompletionRequest): Promise<string> {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new AiError(`AI provider returned ${res.status}`);
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (body.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    },
  };
}
