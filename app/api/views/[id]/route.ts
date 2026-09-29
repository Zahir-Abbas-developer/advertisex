import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";

export async function DELETE(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const access = await requireApi("read", "lead");
  if (access.response) return access.response;

  const view = await prisma.savedView.findUnique({ where: { id: params.id } });
  if (!view || view.userId !== access.principal.id) return apiError("That view no longer exists", 404);
  await prisma.savedView.delete({ where: { id: view.id } });
  return NextResponse.json({ ok: true });
}
