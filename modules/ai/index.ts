import "server-only";

import { anthropicProvider } from "@/modules/ai/anthropic";
import type { AiProvider } from "@/modules/ai/provider";

export type { AiProvider } from "@/modules/ai/provider";

/** Default model; AI_MODEL overrides it. */
export const DEFAULT_AI_MODEL = "claude-sonnet-5";

/**
 * The configured provider, or null when AI is off. Off is a normal state:
 * every AI feature has a deterministic path without it.
 */
export function aiProvider(env: NodeJS.ProcessEnv = process.env): AiProvider | null {
  if (env.AI_ENABLED === "false") return null;
  if (env.ANTHROPIC_API_KEY) return anthropicProvider(env.ANTHROPIC_API_KEY, env.AI_MODEL || DEFAULT_AI_MODEL);
  return null;
}
