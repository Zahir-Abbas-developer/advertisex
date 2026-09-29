import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { requireApi } from "@/modules/rbac/server";
import { parsePrefs } from "@/modules/portal/views";
import { CATEGORY, resolvePreferences, serializePreferences } from "@/modules/notifications/catalog";

/** The client's own profile and notification preferences. */
export async function GET() {
  const gate = await requireApi("read", "profile");
  if (gate.response) return gate.response;
  if (gate.principal.role !== "CLIENT") return apiError("Not found", 404);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: gate.principal.id }, select: { name: true, email: true, phone: true, clientRole: true, notificationPrefs: true } });
  return NextResponse.json({ me: { name: u.name, email: u.email, phone: u.phone, clientRole: u.clientRole ?? "MEMBER", prefs: parsePrefs(u.notificationPrefs) } });
}

const schema = z
  .object({
    name: z.string().trim().min(2, "Your name, please").max(80).optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    prefs: z.object({ messages: z.boolean(), reports: z.boolean(), updates: z.boolean() }).optional(),
  })
  .strict();

export async function PATCH(request: Request) {
  const gate = await requireApi("update", "profile");
  if (gate.response) return gate.response;
  if (gate.principal.role !== "CLIENT") return apiError("Not found", 404);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Please fix the highlighted fields", 422, Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
  const d = parsed.data;
  let notificationPrefs: string | undefined;
  if (d.prefs) {
    // The Phase 6 on/off form, written through the full catalog (Phase 8).
    const current = await prisma.user.findUniqueOrThrow({ where: { id: gate.principal.id }, select: { notificationPrefs: true } });
    const next = resolvePreferences(current.notificationPrefs);
    for (const kind of ["messages", "reports", "updates"] as const) {
      if (!d.prefs[kind]) next.levels[kind] = "off";
      else if (next.levels[kind] === "off") next.levels[kind] = CATEGORY[kind].defaultLevel;
    }
    notificationPrefs = serializePreferences(next);
  }
  await prisma.user.update({
    where: { id: gate.principal.id },
    data: { ...(d.name ? { name: d.name } : {}), ...(d.phone !== undefined ? { phone: d.phone || null } : {}), ...(notificationPrefs ? { notificationPrefs } : {}) },
  });
  return NextResponse.json({ ok: true });
}
