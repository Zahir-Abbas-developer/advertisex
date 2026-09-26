import { z } from "zod";

export const CONTRACT_STATUSES = ["DRAFT", "SENT", "SIGNED", "ACTIVE", "EXPIRED", "TERMINATED"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
  DRAFT: "Draft",
  SENT: "Sent",
  SIGNED: "Signed",
  ACTIVE: "Active",
  EXPIRED: "Expired",
  TERMINATED: "Terminated",
};

export const CONTRACT_STATUS_TONE: Record<ContractStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral",
  SENT: "info",
  SIGNED: "success",
  ACTIVE: "success",
  EXPIRED: "warning",
  TERMINATED: "danger",
};

export const contractFields = {
  title: z.string().trim().min(2, "Name the contract").max(160),
  status: z.enum(CONTRACT_STATUSES).default("DRAFT"),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  signedAt: z.string().nullish(),
  /** Whole currency units. The founder's only. */
  value: z.number().int().min(0).max(100_000_000).optional(),
  notes: z.string().trim().max(2000).nullish(),
};
