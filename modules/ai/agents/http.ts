import "server-only";

import { apiError } from "@/lib/api";
import { ApprovalError } from "@/modules/ai/agents/approvals";
import { RunError } from "@/modules/ai/agents/queue";

/** The one error envelope for the agent routes; anything unexpected is a plain 500. */
export function agentErrorResponse(error: unknown) {
  if (error instanceof RunError || error instanceof ApprovalError) return apiError(error.message, error.status);
  console.error("agent route failed", error);
  return apiError("Something went wrong", 500);
}

export const issues = (e: { issues: { path: (string | number)[]; message: string }[] }) => Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "form", i.message]));
