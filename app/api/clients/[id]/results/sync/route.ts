import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { PROVIDERS, previousMonth } from "@/modules/client-analytics/metrics";
import { clientForResults, currentMonth, ResultsError, syncProvider } from "@/modules/client-analytics/server";

const schema = z.object({ provider: z.enum(PROVIDERS), months: z.number().int().min(1).max(12).default(6) }).strict();

/** Pulls the last N months from a provider (live when switched on; demo data in development; otherwise refused). */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "integration");
  if (gate.response) return gate.response;
  const client = await clientForResults(gate.principal, params.id, "create");
  if (!client) return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Pick a provider", 422);
  const months = [previousMonth(await currentMonth())];
  while (months.length < parsed.data.months) months.unshift(previousMonth(months[0]));
  try {
    return NextResponse.json(await syncProvider(client.id, parsed.data.provider, months));
  } catch (error) {
    if (error instanceof ResultsError) return apiError(error.message, error.status);
    throw error;
  }
}
