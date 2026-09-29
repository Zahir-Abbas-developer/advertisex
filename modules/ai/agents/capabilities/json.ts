import type { z } from "zod";

/** A model's JSON answer, validated — or null (the capability then uses its rules path). */
export function parseJson<T>(text: string | null, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(text.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
