"use client";

import type { ReactNode } from "react";

import { ToastProvider } from "@/components/ui/Toast";

/**
 * The toast surface every mutation reports to.
 *
 * No next-auth SessionProvider (Phase 10): nothing reads the session on the
 * client — pages get the user on the server, and signIn/signOut work without
 * it — and it fetched /api/auth/session on every page load for no reader.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}
