
-- CreateIndex
CREATE INDEX "TaskComment_authorId_idx" ON "TaskComment"("authorId");

-- CreateIndex
CREATE INDEX "Dispute_resolvedById_idx" ON "Dispute"("resolvedById");

-- CreateIndex
CREATE INDEX "DisputeFile_uploaderId_idx" ON "DisputeFile"("uploaderId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "Module_serviceId_idx" ON "Module"("serviceId");

-- CreateIndex
CREATE INDEX "BlockPeriod_createdById_idx" ON "BlockPeriod"("createdById");

-- CreateIndex
CREATE INDEX "BlockPeriod_releasedById_idx" ON "BlockPeriod"("releasedById");

-- CreateIndex
CREATE INDEX "ScoreEvent_createdById_idx" ON "ScoreEvent"("createdById");

-- CreateIndex
CREATE INDEX "ScoreEvent_milestoneId_idx" ON "ScoreEvent"("milestoneId");

-- CreateIndex
CREATE INDEX "Comment_userId_idx" ON "Comment"("userId");

-- CreateIndex
CREATE INDEX "Attachment_uploaderId_idx" ON "Attachment"("uploaderId");

-- CreateIndex
CREATE INDEX "Activity_actorId_idx" ON "Activity"("actorId");

-- CreateIndex
CREATE INDEX "OutageReport_reviewedById_idx" ON "OutageReport"("reviewedById");

-- CreateIndex
CREATE INDEX "Lead_createdById_idx" ON "Lead"("createdById");

-- CreateIndex
CREATE INDEX "Task_createdById_idx" ON "Task"("createdById");

-- CreateIndex
CREATE INDEX "ClientKpiEntry_enteredById_idx" ON "ClientKpiEntry"("enteredById");

-- CreateIndex
CREATE INDEX "LeaveRequest_reviewedById_idx" ON "LeaveRequest"("reviewedById");
