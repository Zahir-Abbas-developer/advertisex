import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/PageHeader";
import { TimeClock } from "@/components/attendance/TimeClock";
import { requirePage } from "@/modules/rbac/server";

export const metadata: Metadata = { title: "My attendance" };

/** The employee's own time clock and month. The API scopes to the caller. */
export default async function MyAttendancePage() {
  await requirePage("create", "attendance");
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Attendance" title="My attendance" description="Clock in when you start, take your breaks, clock out when you're done." />
      <TimeClock />
    </div>
  );
}
