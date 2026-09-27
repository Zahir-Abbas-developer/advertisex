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

export interface AiProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<string>;
}

export class AiError extends Error {}
