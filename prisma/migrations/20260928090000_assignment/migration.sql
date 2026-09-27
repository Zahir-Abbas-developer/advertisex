-- AlterTable
ALTER TABLE "ServiceSkill" ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "ProjectSkill" ADD COLUMN     "weight" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN     "assignmentMode" TEXT NOT NULL DEFAULT 'RECOMMEND',
ADD COLUMN     "assignmentRoleHours" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "assignmentWeights" TEXT NOT NULL DEFAULT '{"skillMatch":40,"availability":10,"capacity":20,"performance":20,"deadlineFit":10}';

-- CreateTable
CREATE TABLE "AssignmentRecommendation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "recommendedUserId" TEXT,
    "score" DOUBLE PRECISION,
    "explanation" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "chosenUserId" TEXT,
    "overrideReason" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'RECOMMEND',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssignmentRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReassignmentSuggestion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "dedupeKey" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReassignmentSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssignmentRecommendation_skillId_status_idx" ON "AssignmentRecommendation"("skillId", "status");

-- CreateIndex
CREATE INDEX "AssignmentRecommendation_recommendedUserId_idx" ON "AssignmentRecommendation"("recommendedUserId");

-- CreateIndex
CREATE INDEX "AssignmentRecommendation_chosenUserId_idx" ON "AssignmentRecommendation"("chosenUserId");

-- CreateIndex
CREATE INDEX "AssignmentRecommendation_decidedById_idx" ON "AssignmentRecommendation"("decidedById");

-- CreateIndex
CREATE UNIQUE INDEX "AssignmentRecommendation_projectId_skillId_key" ON "AssignmentRecommendation"("projectId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "ReassignmentSuggestion_dedupeKey_key" ON "ReassignmentSuggestion"("dedupeKey");

-- CreateIndex
CREATE INDEX "ReassignmentSuggestion_projectId_status_idx" ON "ReassignmentSuggestion"("projectId", "status");

-- CreateIndex
CREATE INDEX "ReassignmentSuggestion_skillId_idx" ON "ReassignmentSuggestion"("skillId");

-- CreateIndex
CREATE INDEX "ReassignmentSuggestion_fromUserId_idx" ON "ReassignmentSuggestion"("fromUserId");

-- CreateIndex
CREATE INDEX "ReassignmentSuggestion_toUserId_idx" ON "ReassignmentSuggestion"("toUserId");

-- CreateIndex
CREATE INDEX "ReassignmentSuggestion_decidedById_idx" ON "ReassignmentSuggestion"("decidedById");

-- AddForeignKey
ALTER TABLE "AssignmentRecommendation" ADD CONSTRAINT "AssignmentRecommendation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentRecommendation" ADD CONSTRAINT "AssignmentRecommendation_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentRecommendation" ADD CONSTRAINT "AssignmentRecommendation_recommendedUserId_fkey" FOREIGN KEY ("recommendedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentRecommendation" ADD CONSTRAINT "AssignmentRecommendation_chosenUserId_fkey" FOREIGN KEY ("chosenUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignmentRecommendation" ADD CONSTRAINT "AssignmentRecommendation_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReassignmentSuggestion" ADD CONSTRAINT "ReassignmentSuggestion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReassignmentSuggestion" ADD CONSTRAINT "ReassignmentSuggestion_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReassignmentSuggestion" ADD CONSTRAINT "ReassignmentSuggestion_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReassignmentSuggestion" ADD CONSTRAINT "ReassignmentSuggestion_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReassignmentSuggestion" ADD CONSTRAINT "ReassignmentSuggestion_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

