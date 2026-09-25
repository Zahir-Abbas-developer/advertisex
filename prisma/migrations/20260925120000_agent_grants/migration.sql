-- CreateTable
CREATE TABLE "AgentGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentGrant_organizationId_idx" ON "AgentGrant"("organizationId");

-- CreateIndex
CREATE INDEX "AgentGrant_grantedById_idx" ON "AgentGrant"("grantedById");

-- CreateIndex
CREATE UNIQUE INDEX "AgentGrant_agentId_resource_action_key" ON "AgentGrant"("agentId", "resource", "action");

-- AddForeignKey
ALTER TABLE "AgentGrant" ADD CONSTRAINT "AgentGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGrant" ADD CONSTRAINT "AgentGrant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentGrant" ADD CONSTRAINT "AgentGrant_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

