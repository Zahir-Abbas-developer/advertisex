-- CreateTable
CREATE TABLE "AgentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maxRunsPerHour" INTEGER NOT NULL DEFAULT 30,
    "monthlyBudgetMicros" INTEGER NOT NULL DEFAULT 5000000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT,
    "departmentId" TEXT,
    "input" TEXT NOT NULL DEFAULT '{}',
    "output" TEXT,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "requestedById" TEXT,
    "ruleId" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "mode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "tool" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT,
    "error" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "departmentId" TEXT,
    "summary" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger" TEXT NOT NULL,
    "conditions" TEXT NOT NULL DEFAULT '{}',
    "action" TEXT NOT NULL,
    "actionConfig" TEXT NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "fireCount" INTEGER NOT NULL DEFAULT 0,
    "lastFiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationFiring" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationFiring_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentProfile_userId_key" ON "AgentProfile"("userId");

-- CreateIndex
CREATE INDEX "AgentProfile_capability_idx" ON "AgentProfile"("capability");

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_status_availableAt_idx" ON "AgentRun"("organizationId", "status", "availableAt");

-- CreateIndex
CREATE INDEX "AgentRun_agentId_createdAt_idx" ON "AgentRun"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_subjectType_subjectId_idx" ON "AgentRun"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AgentRun_organizationId_departmentId_createdAt_idx" ON "AgentRun"("organizationId", "departmentId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_requestedById_idx" ON "AgentRun"("requestedById");

-- CreateIndex
CREATE INDEX "AgentRun_ruleId_idx" ON "AgentRun"("ruleId");

-- CreateIndex
CREATE INDEX "AgentStep_runId_index_idx" ON "AgentStep"("runId", "index");

-- CreateIndex
CREATE INDEX "ApprovalRequest_organizationId_status_idx" ON "ApprovalRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_organizationId_departmentId_status_idx" ON "ApprovalRequest"("organizationId", "departmentId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_runId_idx" ON "ApprovalRequest"("runId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_agentId_idx" ON "ApprovalRequest"("agentId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_decidedById_idx" ON "ApprovalRequest"("decidedById");

-- CreateIndex
CREATE INDEX "ApprovalRequest_subjectType_subjectId_idx" ON "ApprovalRequest"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "AutomationRule_organizationId_trigger_enabled_idx" ON "AutomationRule"("organizationId", "trigger", "enabled");

-- CreateIndex
CREATE INDEX "AutomationRule_createdById_idx" ON "AutomationRule"("createdById");

-- CreateIndex
CREATE INDEX "AutomationFiring_ruleId_createdAt_idx" ON "AutomationFiring"("ruleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationFiring_ruleId_subjectKey_key" ON "AutomationFiring"("ruleId", "subjectKey");

-- AddForeignKey
ALTER TABLE "AgentProfile" ADD CONSTRAINT "AgentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRule" ADD CONSTRAINT "AutomationRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationFiring" ADD CONSTRAINT "AutomationFiring_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

