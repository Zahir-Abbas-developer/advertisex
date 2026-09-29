import "server-only";

import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { storedRoleValues } from "@/config/permissions";

export const AUDIENCES = ["EVERYONE", "TEAM", "CLIENTS"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABEL: Record<Audience, string> = { EVERYONE: "Everyone", TEAM: "The team", CLIENTS: "All clients" };

/**
 * A founder announcement: stored, then delivered to every active person in
 * the audience as an ANNOUNCEMENT notification (in-app always — the category
 * can't be muted — and by email per preference). Clients' links go to their
 * portal; the team's to their notification center.
 */
export async function announce(input: { organizationId: string; authorId: string; title: string; body: string; audience: Audience }) {
  const roles = input.audience === "CLIENTS" ? ["CLIENT"] : input.audience === "TEAM" ? [...storedRoleValues("FOUNDER"), ...storedRoleValues("MANAGER"), ...storedRoleValues("EMPLOYEE")] : null;
  const people = await prisma.user.findMany({
    where: { organizationId: input.organizationId, isActive: true, ...(roles ? { role: { in: roles } } : { role: { notIn: storedRoleValues("AI_AGENT") } }) },
    select: { id: true, role: true },
  });
  const announcement = await prisma.announcement.create({ data: { organizationId: input.organizationId, authorId: input.authorId, title: input.title, body: input.body, audience: input.audience } });
  let recipients = 0;
  for (const p of people) {
    if (p.id === input.authorId) continue;
    const delivered = await notify({
      userId: p.id,
      type: "ANNOUNCEMENT",
      title: input.title,
      body: input.body.length > 280 ? `${input.body.slice(0, 277)}…` : input.body,
      href: p.role === "CLIENT" ? "/portal/notifications" : "/notifications",
      dedupeKey: `announcement:${announcement.id}:${p.id}`,
    });
    if (delivered) recipients += 1;
  }
  await prisma.announcement.update({ where: { id: announcement.id }, data: { recipients } });
  return { ...announcement, recipients };
}
