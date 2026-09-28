"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";

/** Opens a secure checkout for the balance. Shown only when online payments are switched on. */
export function PayOnlineButton({ invoiceId, label }: { invoiceId: string; label: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pay = async () => {
    setBusy(true);
    const res = await safeFetch(`/api/portal/invoices/${invoiceId}/pay`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) {
      setBusy(false);
      return toast.error(body.error ?? "Online payment isn't available right now");
    }
    window.location.assign(body.url);
  };
  return (
    <Button icon={<CreditCard className="h-4 w-4" />} loading={busy} onClick={() => void pay()}>
      {label}
    </Button>
  );
}
