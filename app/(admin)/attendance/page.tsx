import type { Metadata } from "next";

import { PageHeader } from "@/components/ui/PageHeader";
import { TeamAttendance } from "@/components/attendance/TeamAttendance";
import { requirePage } from "@/modules/rbac/server";

export const metadata: Metadata = { title: "Attendance" };

/** Team-wide attendance for a month, with export. Founder and managers only. */
export default async function AttendancePage() {
  await requirePage("read", "ops");
  return (
    <div className="space-y-8">
      <PageHeader eyebrow="Team" title="Attendance" description="Everyone's month against their own schedule. AI agents have no attendance." />
      <TeamAttendance />
    </div>
  );
}
