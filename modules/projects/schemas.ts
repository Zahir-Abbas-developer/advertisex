import { z } from "zod";

/** A project milestone's editable fields, shared by create and update. */
export const milestoneFields = {
  title: z.string().trim().min(2, "Name the milestone").max(160),
  description: z.string().trim().max(2000).nullish(),
  stageId: z.string().min(1).nullish(),
  /** YYYY-MM-DD, on the company calendar. */
  dueDate: z.string().nullish(),
  weight: z.number().int().min(1).max(5).default(1),
  assigneeId: z.string().min(1).nullish(),
};
