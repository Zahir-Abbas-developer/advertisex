import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { CHANNELS } from "@/modules/client-analytics/metrics";
import { clientForResults, currentMonth, resultsFor, ResultsError, saveManual } from "@/modules/client-analytics/server";

/** A client's results for `?month=YYYY-MM` (default: last month), every channel its services bring. */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "clientMetric");
  if (gate.response) return gate.response;
  const client = await clientForResults(gate.principal, params.id, "read");
  if (!client) return apiError("Not found", 404);
  const now = await currentMonth();
  const raw = new URL(request.url).searchParams.get("month");
  const [y, m] = now.split("-").map(Number);
  const fallback = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const month = raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) && raw <= now ? raw : fallback;
  const canEdit = Boolean(await clientForResults(gate.principal, params.id, "create"));
  return NextResponse.json({ results: await resultsFor(client.id, month), canEdit });
}

const schema = z
  .object({
    month: z.string(),
    channel: z.enum(CHANNELS),
    values: z.record(z.string().max(40)),
  })
  .strict();

/** Manual entry: one channel, one month. */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("create", "clientMetric");
  if (gate.response) return gate.response;
  const client = await clientForResults(gate.principal, params.id, "create");
  if (!client) return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("That entry isn't valid", 422);
  try {
    await saveManual(gate.principal, client.id, parsed.data.month, parsed.data.channel, parsed.data.values);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ResultsError) return apiError(error.message, error.status, error.fields);
    throw error;
  }
}
