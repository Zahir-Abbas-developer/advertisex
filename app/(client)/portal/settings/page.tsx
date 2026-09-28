import { PortalSettings } from "@/components/portal/PortalSettings";
import { requireClientPage } from "@/modules/rbac/server";

export const metadata = { title: "Settings · Advertise X" };

export default async function PortalSettingsPage() {
  await requireClientPage();
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow text-brand">Settings</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight tracking-[-0.02em] text-ink">Your account</h1>
      </header>
      <PortalSettings />
    </div>
  );
}
