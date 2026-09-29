import { Suspense } from "react";

import { requireClientPage } from "@/modules/rbac/server";
import { NotificationCenter } from "@/components/notifications/NotificationCenter";

export const metadata = { title: "Notifications · Advertise X" };

export default async function PortalNotificationsPage() {
  await requireClientPage();
  return (
    <Suspense>
      <NotificationCenter />
    </Suspense>
  );
}
