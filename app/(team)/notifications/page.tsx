import type { Metadata } from "next";
import { Suspense } from "react";

import { requirePage } from "@/modules/rbac/server";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requirePage("read", "notification");
  return (
    <Suspense>
      <NotificationCenter />
    </Suspense>
  );
}
