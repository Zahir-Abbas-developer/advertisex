import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { SESSION_ENDED_ROUTE } from "@/lib/routes";
import { requireUser } from "@/lib/session";
import { currentCycle, ledgerFor, onTimeRateFor, performanceContext, scoresForCycle } from "@/lib/score-service";
import { monthlyScore, scoreBand } from "@/lib/scoring";
import { PerformanceProfile } from "@/components/performance/PerformanceProfile";
import { qualityForCycle } from "@/lib/quality-service";
import { moduleGate } from "@/lib/module-guard";

export const metadata: Metadata = {
  title: "My performance",
};

export default async function MyPerformancePage() {
  // Parked module: the nav entry is already gone, so this guards a
  // bookmark or a typed URL rather than a link.
  const gate = await moduleGate("scoring");
  if (gate) return gate;

  const user = await requireUser();
  const cycle = currentCycle();

  const [member, scores, ledger, onTime, context, quality] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, name: true, jobTitle: true, avatarColor: true },
    }),
    scoresForCycle([user.id], cycle),
    ledgerFor(user.id, cycle),
    onTimeRateFor([user.id], cycle),
    performanceContext([user.id], cycle),
    qualityForCycle(user.id, cycle),
  ]);

  // The session always corresponds to a real row, but a deleted account mid
  // session is signed out rather than shown a blank page.
  if (!member) redirect(SESSION_ENDED_ROUTE);

  const score = scores.get(user.id) ?? {
    userId: user.id,
    score: monthlyScore([]),
    band: scoreBand(monthlyScore([])),
    trend: null,
    eventCount: 0,
    deductions: 0,
    bonuses: 0,
  };

  return (
    <PerformanceProfile
      member={member}
      score={score}
      ledger={ledger}
      cycle={cycle}
      onTime={onTime.get(user.id) ?? { onTime: 0, total: 0, rate: 0 }}
      load={{
        count: context.get(user.id)?.load ?? 0,
        weight: context.get(user.id)?.totalWeight ?? 0,
      }}
      quality={quality}
      viewerIsAdmin={false}
      isSelf
    />
  );
}
