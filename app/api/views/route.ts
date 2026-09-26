import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { requireApi } from "@/modules/rbac/server";
import { leadFiltersSchema, parseFilters } from "@/modules/leads/domain";

/** A person's saved pipeline views — their own, never shared. */
export async function GET() {
  const access = await requireApi("read", "lead");
  if (access.response) return access.response;

  const views = await prisma.savedView.findMany({
    where: { userId: access.principal.id, scope: "LEADS" },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({
    views: views.map((v) => {
      let raw: unknown = {};
      try {
        raw = JSON.parse(v.filters);
      } catch {
        raw = {};
      }
      return { id: v.id, name: v.name, filters: parseFilters(raw) };
    }),
  });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(60), filters: leadFiltersSchema });

export async function POST(request: Request) {
  const access = await requireApi("read", "lead");
  if (access.response) return access.response;
  if (!access.principal.organizationId) return apiError("Your account has no organization", 403);

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));

  const existing = await prisma.savedView.findUnique({
    where: { userId_scope_name: { userId: access.principal.id, scope: "LEADS", name: parsed.data.name } },
  });
  const view = existing
    ? await prisma.savedView.update({ where: { id: existing.id }, data: { filters: JSON.stringify(parsed.data.filters) } })
    : await prisma.savedView.create({
        data: {
          organizationId: access.principal.organizationId,
          userId: access.principal.id,
          scope: "LEADS",
          name: parsed.data.name,
          filters: JSON.stringify(parsed.data.filters),
        },
      });
  return NextResponse.json({ view: { id: view.id, name: view.name, filters: parsed.data.filters } }, { status: existing ? 200 : 201 });
}
