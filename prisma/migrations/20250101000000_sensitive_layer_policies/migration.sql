-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "organizationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PolicyDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "extractedCharCount" INTEGER,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'PDF',
    "lifecycle" TEXT NOT NULL DEFAULT 'DRAFT',
    "compiledRules" TEXT,
    "reviewedAt" DATETIME,
    "activatedAt" DATETIME,
    CONSTRAINT "PolicyDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PolicyDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PolicyChunk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "normalizedContent" TEXT NOT NULL,
    "isRestricted" BOOLEAN NOT NULL DEFAULT false,
    "pageIndex" INTEGER,
    "textHash" TEXT,
    "spanStart" INTEGER,
    "spanEnd" INTEGER,
    "isCandidate" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "PolicyChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PolicyDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PolicyRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "patterns" TEXT NOT NULL DEFAULT '[]',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "category" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isManual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "detectorType" TEXT NOT NULL DEFAULT 'SEMANTIC',
    "checksumKind" TEXT,
    "dictionaryId" TEXT,
    "action" TEXT NOT NULL DEFAULT 'BLOCK_EXTERNAL',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "sourceQuote" TEXT,
    "sourcePage" INTEGER,
    "textHash" TEXT,
    "conflictGroup" TEXT,
    "reviewNote" TEXT,
    "chunkId" TEXT,
    CONSTRAINT "PolicyRule_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "PolicyDocument" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PolicyRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PolicyAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PolicyAuditLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaskDictionary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MaskDictionary_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PolicyDecisionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "score" REAL NOT NULL DEFAULT 0,
    "reasons" TEXT NOT NULL DEFAULT '[]',
    "matchedRuleIds" TEXT NOT NULL DEFAULT '[]',
    "promptHash" TEXT NOT NULL,
    "promptPreview" TEXT NOT NULL,
    "promptLength" INTEGER NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "route" TEXT,
    "maskCount" INTEGER NOT NULL DEFAULT 0,
    "maskLabels" TEXT NOT NULL DEFAULT '[]',
    "isSensitive" BOOLEAN,
    "classifierCategory" TEXT,
    "classifierRisk" TEXT,
    "classifierReason" TEXT,
    "classifierLatencyMs" INTEGER,
    "sourceIp" TEXT,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    CONSTRAINT "PolicyDecisionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PolicyDecisionLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ChatSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "_RuleToLog" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_RuleToLog_A_fkey" FOREIGN KEY ("A") REFERENCES "PolicyDecisionLog" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_RuleToLog_B_fkey" FOREIGN KEY ("B") REFERENCES "PolicyRule" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "PolicyChunk_documentId_idx" ON "PolicyChunk"("documentId");

-- CreateIndex
CREATE INDEX "PolicyChunk_documentId_index_idx" ON "PolicyChunk"("documentId", "index");

-- CreateIndex
CREATE INDEX "PolicyRule_organizationId_idx" ON "PolicyRule"("organizationId");

-- CreateIndex
CREATE INDEX "PolicyRule_organizationId_status_idx" ON "PolicyRule"("organizationId", "status");

-- CreateIndex
CREATE INDEX "PolicyRule_documentId_idx" ON "PolicyRule"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyRule_organizationId_code_key" ON "PolicyRule"("organizationId", "code");

-- CreateIndex
CREATE INDEX "PolicyAuditLog_organizationId_createdAt_idx" ON "PolicyAuditLog"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "PolicyAuditLog_action_idx" ON "PolicyAuditLog"("action");

-- CreateIndex
CREATE INDEX "MaskDictionary_organizationId_kind_idx" ON "MaskDictionary"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "MaskDictionary_organizationId_kind_term_key" ON "MaskDictionary"("organizationId", "kind", "term");

-- CreateIndex
CREATE INDEX "PolicyDecisionLog_organizationId_idx" ON "PolicyDecisionLog"("organizationId");

-- CreateIndex
CREATE INDEX "PolicyDecisionLog_createdAt_idx" ON "PolicyDecisionLog"("createdAt");

-- CreateIndex
CREATE INDEX "ChatSession_userId_idx" ON "ChatSession"("userId");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_idx" ON "ChatMessage"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "_RuleToLog_AB_unique" ON "_RuleToLog"("A", "B");

-- CreateIndex
CREATE INDEX "_RuleToLog_B_index" ON "_RuleToLog"("B");

