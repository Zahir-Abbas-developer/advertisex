import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { openReport } from "@/modules/portal/server";

const schema = z.object({ disposition: z.enum(["inline", "attachment"]).default("inline") }).strict();

/** Marks a report read for this person and returns a five-minute link to it. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "clientReport");
  if (gate.response) return gate.response;
  if (gate.principal.role !== "CLIENT") return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return apiError("Bad request", 400);
  const url = await openReport(gate.principal, params.id, parsed.data.disposition);
  if (!url) return apiError("Not found", 404);
  return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
}
