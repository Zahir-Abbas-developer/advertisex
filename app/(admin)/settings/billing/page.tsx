import type { Metadata } from "next";

import { BillingSettingsForm } from "@/components/settings/BillingSettingsForm";

export const metadata: Metadata = { title: "Billing" };

/** Invoice numbering, currency, terms and the seller details printed on invoices. Founder-only (settings layout). */
export default function BillingSettingsPage() {
  return <BillingSettingsForm />;
}
