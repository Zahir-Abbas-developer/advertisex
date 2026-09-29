import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { recentFor, unreadCount } from "@/lib/notifications";
import type { NotificationType } from "@/lib/notification-types";
import { CATEGORIES, TYPE_CATEGORY, type Category } from "@/modules/notifications/catalog";

import { requireApi } from "@/modules/rbac/server";
/**
 * The signed-in person's notifications. With no query: the bell's view (the
 * latest 20 and the unread count). With `?page=` the notification center's:
 * `unread=1`, `category=` (modules/notifications/catalog.ts), 30 a page.
 */
export async function GET(request: Request) {
  const access = await requireApi("read", "notification");
  if (access.response) return access.response;

  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const p = new URL(request.url).searchParams;
  try {
    if (!p.has("page")) {
      const [notifications, unread] = await Promise.all([recentFor(user.id), unreadCount(user.id)]);
      return NextResponse.json({ notifications, unread });
    }
    const page = Math.max(1, Number(p.get("page")) || 1);
    const category = p.get("category");
    const types = category && (CATEGORIES as readonly string[]).includes(category) ? typesIn(category as Category) : null;
    const where = { userId: user.id, ...(p.get("unread") === "1" ? { readAt: null } : {}), ...(types ? { type: { in: types } } : {}) };
    const [rows, total, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * CENTER_PAGE, take: CENTER_PAGE }),
      prisma.notification.count({ where }),
      unreadCount(user.id),
    ]);
    return NextResponse.json({
      notifications: rows.map((n) => ({ ...n, category: TYPE_CATEGORY[n.type as NotificationType] ?? "system" })),
      total,
      page,
      pageSize: CENTER_PAGE,
      unread,
    });
  } catch {
    return apiError("Couldn't load your notifications", 500);
  }
}

const CENTER_PAGE = 30;
const typesIn = (category: Category) => (Object.entries(TYPE_CATEGORY) as [NotificationType, Category][]).filter(([, c]) => c === category).map(([t]) => t);

/** Mark everything read. */
export async function POST() {
  const access = await requireApi("update", "notification");
  if (access.response) return access.response;

  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  try {
    const result = await prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ marked: result.count });
  } catch {
    return apiError("Couldn't update your notifications", 500);
  }
}
