-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "preferredName" TEXT,
    "countryCode" TEXT NOT NULL,
    "hireDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "photoUrl" TEXT,

    CONSTRAINT "Worker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupervisoryOrg" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "managerId" TEXT,

    CONSTRAINT "SupervisoryOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobProfile" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "track" TEXT NOT NULL,

    CONSTRAINT "JobProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "supOrgId" TEXT NOT NULL,
    "jobProfileId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionAssignment" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "PositionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompBand" (
    "id" TEXT NOT NULL,
    "jobProfileId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "bandMin" DECIMAL(65,30) NOT NULL,
    "bandMid" DECIMAL(65,30) NOT NULL,
    "bandMax" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "CompBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompRecord" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "annualSalary" DECIMAL(65,30) NOT NULL,
    "currency" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "reason" TEXT NOT NULL,

    CONSTRAINT "CompRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "currency" TEXT NOT NULL,
    "toUsd" DECIMAL(65,30) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("currency")
);

-- CreateTable
CREATE TABLE "WorkerEvent" (
    "id" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "payload" TEXT NOT NULL,
    "bpInstanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkerEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BpDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "BpDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BpStep" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "assigneeRule" TEXT NOT NULL,
    "conditionRule" TEXT,

    CONSTRAINT "BpStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BpInstance" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "subjectWorkerId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "proposedChange" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "BpInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BpStepInstance" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "stepName" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "comment" TEXT,
    "actedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BpStepInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "assumptions" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnomalyAcknowledgment" (
    "id" TEXT NOT NULL,
    "anomalyKey" TEXT NOT NULL,
    "acknowledgedBy" TEXT NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnomalyAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProxyAuditLog" (
    "id" TEXT NOT NULL,
    "actualUserId" TEXT NOT NULL,
    "proxyUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProxyAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Worker_status_idx" ON "Worker"("status");

-- CreateIndex
CREATE INDEX "Worker_countryCode_idx" ON "Worker"("countryCode");

-- CreateIndex
CREATE INDEX "Position_status_idx" ON "Position"("status");

-- CreateIndex
CREATE INDEX "PositionAssignment_workerId_effectiveTo_idx" ON "PositionAssignment"("workerId", "effectiveTo");

-- CreateIndex
CREATE INDEX "PositionAssignment_positionId_effectiveTo_idx" ON "PositionAssignment"("positionId", "effectiveTo");

-- CreateIndex
CREATE INDEX "CompBand_jobProfileId_countryCode_idx" ON "CompBand"("jobProfileId", "countryCode");

-- CreateIndex
CREATE INDEX "CompRecord_workerId_effectiveTo_idx" ON "CompRecord"("workerId", "effectiveTo");

-- CreateIndex
CREATE INDEX "WorkerEvent_workerId_idx" ON "WorkerEvent"("workerId");

-- CreateIndex
CREATE INDEX "WorkerEvent_type_idx" ON "WorkerEvent"("type");

-- CreateIndex
CREATE INDEX "BpStep_definitionId_order_idx" ON "BpStep"("definitionId", "order");

-- CreateIndex
CREATE INDEX "BpInstance_status_idx" ON "BpInstance"("status");

-- CreateIndex
CREATE INDEX "BpInstance_subjectWorkerId_idx" ON "BpInstance"("subjectWorkerId");

-- CreateIndex
CREATE INDEX "BpStepInstance_instanceId_idx" ON "BpStepInstance"("instanceId");

-- CreateIndex
CREATE INDEX "BpStepInstance_assigneeId_action_idx" ON "BpStepInstance"("assigneeId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "AnomalyAcknowledgment_anomalyKey_key" ON "AnomalyAcknowledgment"("anomalyKey");

-- CreateIndex
CREATE INDEX "ProxyAuditLog_actualUserId_idx" ON "ProxyAuditLog"("actualUserId");

-- CreateIndex
CREATE INDEX "ProxyAuditLog_proxyUserId_idx" ON "ProxyAuditLog"("proxyUserId");

-- CreateIndex
CREATE INDEX "ProxyAuditLog_createdAt_idx" ON "ProxyAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "SupervisoryOrg" ADD CONSTRAINT "SupervisoryOrg_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "SupervisoryOrg"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupervisoryOrg" ADD CONSTRAINT "SupervisoryOrg_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_supOrgId_fkey" FOREIGN KEY ("supOrgId") REFERENCES "SupervisoryOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionAssignment" ADD CONSTRAINT "PositionAssignment_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionAssignment" ADD CONSTRAINT "PositionAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompBand" ADD CONSTRAINT "CompBand_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompRecord" ADD CONSTRAINT "CompRecord_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerEvent" ADD CONSTRAINT "WorkerEvent_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BpStep" ADD CONSTRAINT "BpStep_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "BpDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BpInstance" ADD CONSTRAINT "BpInstance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "BpDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BpInstance" ADD CONSTRAINT "BpInstance_subjectWorkerId_fkey" FOREIGN KEY ("subjectWorkerId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BpInstance" ADD CONSTRAINT "BpInstance_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BpStepInstance" ADD CONSTRAINT "BpStepInstance_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "BpInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BpStepInstance" ADD CONSTRAINT "BpStepInstance_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
