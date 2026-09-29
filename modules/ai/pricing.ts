/**
 * What a model call costs, in micro-dollars (1,000,000 = $1) — integers, like
 * all money here. Prices are per million tokens; unknown models use the
 * default row, and AI_PRICE_INPUT / AI_PRICE_OUTPUT (dollars per million)
 * override it for the configured model.
 */
const PER_MILLION: Record<string, { input: number; output: number }> = {
  default: { input: 3, output: 15 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "fake-model": { input: 3, output: 15 },
};

export function costMicros(model: string, inputTokens: number, outputTokens: number, env: NodeJS.ProcessEnv = process.env): number {
  const row = PER_MILLION[model] ?? PER_MILLION.default;
  const input = env.AI_PRICE_INPUT ? Number(env.AI_PRICE_INPUT) : row.input;
  const output = env.AI_PRICE_OUTPUT ? Number(env.AI_PRICE_OUTPUT) : row.output;
  // $/M tokens × tokens = micro-dollars exactly.
  return Math.round(inputTokens * input + outputTokens * output);
}

export const formatMicros = (micros: number) => `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`;
