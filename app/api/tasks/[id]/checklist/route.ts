import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { requireApi } from "@/modules/rbac/server";
import { taskAccess } from "@/modules/tasks/server";

/** A task's checklist. Anyone who can see the task reads it; whoever may change the task edits it. */

async function writable(principal: Parameters<typeof taskAccess>[0], id: string) {
  const access = await taskAccess(principal, id, "write");
  return access.ok ? null : apiError(access.error, access.status);
}

export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("read", "task");
  if (gate.response) return gate.response;
  const access = await taskAccess(gate.principal, params.id, "read");
  if (!access.ok) return apiError(access.error, access.status);

  const items = await prisma.taskChecklistItem.findMany({
    where: { taskId: params.id },
    orderBy: { order: "asc" },
    select: { id: true, label: true, done: true },
  });
  return NextResponse.json({ items });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "task");
  if (gate.response) return gate.response;
  const refused = await writable(gate.principal, params.id);
  if (refused) return refused;

  const parsed = z.object({ label: z.string().trim().min(1).max(200) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));

  const last = await prisma.taskChecklistItem.findFirst({ where: { taskId: params.id }, orderBy: { order: "desc" } });
  const item = await prisma.taskChecklistItem.create({
    data: { taskId: params.id, label: parsed.data.label, order: (last?.order ?? -1) + 1 },
  });
  return NextResponse.json({ item }, { status: 201 });
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "task");
  if (gate.response) return gate.response;
  const refused = await writable(gate.principal, params.id);
  if (refused) return refused;

  const parsed = z
    .object({ itemId: z.string().min(1), done: z.boolean().optional(), label: z.string().trim().min(1).max(200).optional() })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));

  const item = await prisma.taskChecklistItem.findFirst({ where: { id: parsed.data.itemId, taskId: params.id } });
  if (!item) return apiError("That checklist item no longer exists", 404);

  const updated = await prisma.taskChecklistItem.update({
    where: { id: item.id },
    data: {
      ...(parsed.data.done !== undefined ? { done: parsed.data.done } : {}),
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
    },
  });
  return NextResponse.json({ item: updated });
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const gate = await requireApi("update", "task");
  if (gate.response) return gate.response;
  const refused = await writable(gate.principal, params.id);
  if (refused) return refused;

  const itemId = new URL(request.url).searchParams.get("itemId");
  const item = itemId ? await prisma.taskChecklistItem.findFirst({ where: { id: itemId, taskId: params.id } }) : null;
  if (!item) return apiError("That checklist item no longer exists", 404);

  await prisma.taskChecklistItem.delete({ where: { id: item.id } });
  return NextResponse.json({ ok: true });
}
