import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { notifyTeam, projectFor } from "@/modules/projects/server";

/** The project's internal discussion thread. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("read", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "read");
  if (!found.project) return apiError("That project doesn't exist", 404);

  const comments = await prisma.projectComment.findMany({
    where: { projectId: params.id },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true, avatarColor: true } } },
  });
  return NextResponse.json({ comments });
}

const schema = z.object({ body: z.string().trim().min(1, "Write something").max(4000) }).strict();

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const gate = await requireApi("update", "project");
  if (gate.response) return gate.response;
  const found = await projectFor(gate.principal, params.id, "update");
  if (!found.project) return apiError("That project doesn't exist", found.status);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, { body: "Write something" });
  const comment = await prisma.projectComment.create({
    data: { projectId: params.id, authorId: gate.principal.id, body: parsed.data.body },
    select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true, avatarColor: true } } },
  });
  await notifyTeam(params.id, gate.principal.id, {
    type: "PROJECT_UPDATED",
    title: `${comment.author?.name ?? "Someone"} commented on ${found.project.title}`,
    body: parsed.data.body.slice(0, 140),
  });
  return NextResponse.json({ comment }, { status: 201 });
}
