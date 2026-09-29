import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { announce, AUDIENCES } from "@/modules/notifications/announcements";

/** Recent announcements (the founder's). */
export async function GET() {
  const gate = await requireApi("read", "announcement");
  if (gate.response) return gate.response;
  const announcements = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { author: { select: { name: true } } } });
  return NextResponse.json({ announcements: announcements.map((a) => ({ id: a.id, title: a.title, body: a.body, audience: a.audience, recipients: a.recipients, createdAt: a.createdAt.toISOString(), author: a.author?.name ?? null })) });
}

const schema = z
  .object({
    title: z.string().trim().min(3, "A short headline").max(120),
    body: z.string().trim().min(3, "What do you want to say?").max(2000),
    audience: z.enum(AUDIENCES),
  })
  .strict();

/** Sends one. Everyone in the audience is notified (in-app, and email per preference). */
export async function POST(request: Request) {
  const gate = await requireApi("create", "announcement");
  if (gate.response) return gate.response;
  if (!gate.principal.organizationId) return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const a = await announce({ organizationId: gate.principal.organizationId, authorId: gate.principal.id, ...parsed.data });
  return NextResponse.json({ announcement: { id: a.id, recipients: a.recipients } }, { status: 201 });
}
