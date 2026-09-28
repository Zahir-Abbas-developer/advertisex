"use client";

import { useState } from "react";
import { Info } from "lucide-react";

import { Modal } from "@/components/ui/Modal";

/**
 * "How this is calculated" — the visible definition every team metric carries
 * (Phase 2 scope 6). The wording is the plain-language form of the formulas in
 * docs/METRICS.md; the numbers themselves come from modules/attendance/domain
 * and modules/tasks/domain, which the tests pin. If a formula changes, this
 * text changes in the same commit.
 */

const DEFINITIONS = {
  attendance: {
    title: "How attendance is calculated",
    items: [
      ["Your schedule", "Each person has working days and hours in their own timezone (default Monday–Friday, 9:00–17:00). Everything below is measured against it, on that clock."],
      ["Hours worked", "From clock-in to clock-out, minus breaks. A break still running counts until you clock out."],
      ["Late", "Clocking in more than the grace period (normally 5 minutes) after your start time. Lateness is counted from the start time itself, so 9:12 is 12 minutes late."],
      ["Left early", "Clocking out before your scheduled end time, on a working day."],
      ["Absent", "A scheduled working day that ended with no clock-in. Approved leave is never an absence."],
      ["Attendance", "Days worked ÷ scheduled days so far this month, not counting approved leave."],
      ["Punctuality", "Days you arrived on time ÷ days you worked."],
    ],
  },
  performance: {
    title: "How performance is calculated",
    items: [
      ["Deadline", "A task is due by the end of its due date on the company clock."],
      ["Tasks completed", "Tasks marked Completed during the selected month."],
      ["Overdue", "Open tasks whose deadline has passed, right now."],
      ["On-time delivery", "Of the tasks completed this month that had a due date, the share completed by it. Shown as — when there are none: no work is not bad work."],
      ["Workload", "Open tasks × 2 hours ÷ weekly capacity. Can pass 100% — overload is shown, not hidden."],
      ["Projects delivered", "Projects closed out as completed this month that the person had work on."],
      ["Team totals", "Pooled from everyone's own counts, never an average of averages."],
    ],
  },
} as const;

export function HowCalculated({ topic }: { topic: keyof typeof DEFINITIONS }) {
  const [open, setOpen] = useState(false);
  const def = DEFINITIONS[topic];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[12px] text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
      >
        <Info className="h-3.5 w-3.5" />
        How this is calculated
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={def.title} eyebrow="Definitions">
        <dl className="space-y-3.5">
          {def.items.map(([term, meaning]) => (
            <div key={term}>
              <dt className="text-[13px] font-medium text-ink">{term}</dt>
              <dd className="mt-0.5 text-[13px] leading-relaxed text-ink-muted">{meaning}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </>
  );
}
