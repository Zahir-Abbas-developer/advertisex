import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { CATEGORY, CATEGORIES, categoriesFor, LEVELS, resolvePreferences, serializePreferences } from "@/modules/notifications/catalog";

/** The signed-in person's notification preferences, for the categories their role can receive. */
export async function GET() {
  const gate = await requireApi("read", "notification");
  if (gate.response) return gate.response;
  const u = await prisma.user.findUniqueOrThrow({ where: { id: gate.principal.id }, select: { notificationPrefs: true } });
  const prefs = resolvePreferences(u.notificationPrefs);
  return NextResponse.json({
    categories: categoriesFor(gate.principal.role).map((key) => ({ key, label: CATEGORY[key].label, description: (gate.principal.role === "CLIENT" && CATEGORY[key].clientDescription) || CATEGORY[key].description, minimum: CATEGORY[key].minimum, level: prefs.levels[key] })),
    digest: prefs.digest,
  });
}

const schema = z
  .object({
    levels: z.record(z.enum(CATEGORIES), z.enum(LEVELS)).optional(),
    digest: z.boolean().optional(),
  })
  .strict();

/** Updates them. A level below a category's minimum is raised to it (announcements and billing can't be muted). */
export async function PATCH(request: Request) {
  const gate = await requireApi("update", "notification");
  if (gate.response) return gate.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Those preferences aren't valid", 422);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: gate.principal.id }, select: { notificationPrefs: true } });
  const prefs = resolvePreferences(u.notificationPrefs);
  const allowed = new Set(categoriesFor(gate.principal.role));
  for (const [key, level] of Object.entries(parsed.data.levels ?? {})) {
    if (allowed.has(key as (typeof CATEGORIES)[number])) prefs.levels[key as (typeof CATEGORIES)[number]] = level;
  }
  if (parsed.data.digest !== undefined) prefs.digest = parsed.data.digest;
  // Re-resolve so minimums hold.
  const next = resolvePreferences(serializePreferences(prefs));
  await prisma.user.update({ where: { id: gate.principal.id }, data: { notificationPrefs: serializePreferences(next) } });
  return NextResponse.json({ ok: true, digest: next.digest, levels: next.levels });
}
