"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { safeFetch } from "@/lib/safe-fetch";

/** Downloads a report's PDF through a five-minute signed link. */
export function ReportDownloadButton({ reportId }: { reportId: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    const res = await safeFetch(`/api/portal/reports/${reportId}/open`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ disposition: "attachment" }) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) return toast.error("Couldn't download it right now");
    window.location.assign(body.url);
  };
  return (
    <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} loading={busy} onClick={() => void download()}>
      Download PDF
    </Button>
  );
}
