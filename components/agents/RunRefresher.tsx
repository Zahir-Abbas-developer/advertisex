"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** While a run is queued or working, re-render the page every few seconds so its steps appear as they happen. */
export function RunRefresher({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 2500);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
