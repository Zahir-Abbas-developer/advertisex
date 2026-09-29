/**
 * The AI layer's one interface (CLAUDE.md §5: `modules/ai` is provider-
 * agnostic; the provider is configuration). Everything that uses AI takes an
 * `AiProvider`, so tests pass a fake and the product works — deterministically
 * — with no provider configured at all.
 */
export type CompletionRequest = {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Abort after this long; AI is never allowed to hold up a request. */
  timeoutMs?: number;
};

export type CompletionResult = {
  text: string;
  /** The model that answered, for pricing. */
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export interface AiProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<string>;
  /** The same call, with usage — what agents use, so every run's cost is known (Phase 9). */
  completeWithUsage(request: CompletionRequest): Promise<CompletionResult>;
}

export class AiError extends Error {}
