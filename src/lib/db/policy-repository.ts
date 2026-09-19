import { db } from './client';
import type { PolicyDocument, PolicyRule } from './types';
import type { PolicySnapshot } from './types';
import {
  Prisma,
  type PolicyDocumentStatus,
  type RuleSeverity,
  type PolicyLifecycle,
  type RuleStatus,
  type RuleDetectorType,
  type CompiledRuleAction,
} from '@prisma/client';

// ─── Policy Documents ──────────────────────────────────────────────────────

export async function getActivePolicyDocument(organizationId: string): Promise<PolicyDocument | null> {
  return db.policyDocument.findFirst({
    where: { organizationId, isActive: true },
  });
}

export async function getPolicyDocuments(organizationId: string): Promise<PolicyDocument[]> {
  return db.policyDocument.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getPolicyDocumentById(
  documentId: string,
  organizationId: string,
): Promise<PolicyDocument | null> {
  return db.policyDocument.findFirst({
    where: { id: documentId, organizationId },
  });
}

export async function createPolicyDocument(data: {
  id?: string; // explicit id — callers may pre-generate one to align with the stored filename
  organizationId: string;
  filename: string;
  mimeType: string;
  size: number;
  storagePath: string;
  uploadedById: string;
  sourceType?: 'PDF' | 'TXT' | 'MD';
}): Promise<PolicyDocument> {
  return db.policyDocument.create({
    data: {
      id: data.id,
      organizationId: data.organizationId,
      filename: data.filename,
      mimeType: data.mimeType,
      size: data.size,
      storagePath: data.storagePath,
      uploadedById: data.uploadedById,
      sourceType: data.sourceType ?? 'PDF',
    },
  });
}

export async function updatePolicyDocumentStatus(
  id: string,
  status: PolicyDocumentStatus,
  errorMessage?: string,
  extractedCharCount?: number,
): Promise<PolicyDocument> {
  const doc = await db.policyDocument.findUnique({ where: { id } });
  if (!doc) {
    throw new Error(`PolicyDocument with id "${id}" not found`);
  }
  return db.policyDocument.update({
    where: { id },
    data: { status, errorMessage, extractedCharCount },
  });
}

export async function activatePolicyDocument(
  id: string,
  organizationId: string,
): Promise<PolicyDocument> {
  const doc = await db.policyDocument.findFirst({ where: { id, organizationId } });
  if (!doc) {
    throw new Error(`PolicyDocument with id "${id}" not found in organization "${organizationId}"`);
  }

  await db.policyDocument.updateMany({
    where: { organizationId, isActive: true, id: { not: id } },
    data: { isActive: false, lifecycle: 'ARCHIVED' as PolicyLifecycle },
  });

  return db.policyDocument.update({
    where: { id },
    data: { isActive: true, lifecycle: 'ACTIVE' as PolicyLifecycle, activatedAt: new Date() },
  });
}

/** Lifecycle transition (Sensitive-Data Layer) — validity is checked by canTransitionLifecycle. */
export async function updatePolicyDocumentLifecycle(
  id: string,
  organizationId: string,
  lifecycle: PolicyLifecycle,
): Promise<PolicyDocument> {
  const doc = await db.policyDocument.findFirst({ where: { id, organizationId } });
  if (!doc) {
    throw new Error(`PolicyDocument with id "${id}" not found in organization "${organizationId}"`);
  }
  const data: Record<string, unknown> = { lifecycle };
  if (lifecycle === 'REVIEW') data.reviewedAt = new Date();
  if (lifecycle === 'ACTIVE') {
    data.activatedAt = new Date();
    data.isActive = true;
  }
  if (lifecycle === 'ARCHIVED') data.isActive = false;
  return db.policyDocument.update({ where: { id }, data });
}

/** Persist compiled runtime rules (JSON) written on activation. */
export async function saveCompiledRules(
  id: string,
  compiledJson: string,
): Promise<PolicyDocument> {
  return db.policyDocument.update({ where: { id }, data: { compiledRules: compiledJson } });
}

/** Fetch compiled rules of the ACTIVE document (already parsed & validated). */
export async function getActiveCompiledRules(
  organizationId: string,
): Promise<import('@/lib/policy/types').CompiledPolicyRule[]> {
  const active = await getActivePolicyDocument(organizationId);
  if (!active?.compiledRules) return [];
  try {
    const parsed = JSON.parse(active.compiledRules);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function deletePolicyDocument(id: string, organizationId: string): Promise<void> {
  const doc = await db.policyDocument.findFirst({ where: { id, organizationId } });
  if (!doc) {
    throw new Error(`PolicyDocument with id "${id}" not found in organization "${organizationId}"`);
  }
  await db.policyDocument.delete({ where: { id } });
}

// ─── Policy Snapshot ────────────────────────────────────────────────────────

export async function getPolicySnapshot(organizationId: string): Promise<PolicySnapshot | null> {
  const activeDoc = await getActivePolicyDocument(organizationId);
  if (!activeDoc) return null;

  const [rules, chunks] = await Promise.all([
    db.policyRule.findMany({
      where: { organizationId, isActive: true },
    }),
    db.policyChunk.findMany({
      where: { documentId: activeDoc.id },
    }),
  ]);

  return {
    rules: rules.map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      keywords: safeParseJsonArray(r.keywords),
      patterns: safeParseJsonArray(r.patterns),
      severity: r.severity as RuleSeverity,
      category: r.category,
      isActive: r.isActive,
    })),
    chunks: chunks.map((c) => ({
      id: c.id,
      content: c.content,
      normalizedContent: c.normalizedContent,
      isRestricted: c.isRestricted,
    })),
  };
}

// ─── Policy Chunks ──────────────────────────────────────────────────────────

export async function createPolicyChunks(
  chunks: {
    documentId: string;
    index: number;
    content: string;
    normalizedContent: string;
    isRestricted: boolean;
    pageIndex?: number | null;
    textHash?: string | null;
    spanStart?: number | null;
    spanEnd?: number | null;
    isCandidate?: boolean;
  }[],
): Promise<void> {
  await db.policyChunk.createMany({
    data: chunks.map((c) => ({
      documentId: c.documentId,
      index: c.index,
      content: c.content,
      normalizedContent: c.normalizedContent,
      isRestricted: c.isRestricted,
      pageIndex: c.pageIndex ?? null,
      textHash: c.textHash ?? null,
      spanStart: c.spanStart ?? null,
      spanEnd: c.spanEnd ?? null,
      isCandidate: c.isCandidate ?? false,
    })),
  });
}

export async function getPolicyChunks(documentId: string) {
  return db.policyChunk.findMany({
    where: { documentId },
    orderBy: { index: 'asc' },
  });
}

// ─── Policy Rules ───────────────────────────────────────────────────────────

export async function getPolicyRules(organizationId: string): Promise<PolicyRule[]> {
  return db.policyRule.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getPolicyRulesByDocument(documentId: string): Promise<PolicyRule[]> {
  return db.policyRule.findMany({
    where: { documentId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Rule codes follow the auto-generated `R-###` series and are unique per
 * organization (@@unique([organizationId, code])). Extracted-rule numbering
 * must therefore continue AFTER the highest code already stored for the org
 * (seed rules, manual rules, or rules from previously uploaded documents).
 * Returns 0 when the organization has no `R-###` rules yet.
 */
export async function getMaxRuleCodeNumber(organizationId: string): Promise<number> {
  const rules = await db.policyRule.findMany({
    where: { organizationId, code: { startsWith: 'R-' } },
    select: { code: true },
  });

  let max = 0;
  for (const { code } of rules) {
    const match = /^R-(\d+)$/.exec(code);
    if (match) {
      const n = parseInt(match[1], 10);
      if (Number.isSafeInteger(n) && n > max) max = n;
    }
  }
  return max;
}

/** True when the error is Prisma's unique-constraint violation (P2002). */
export function isUniqueConstraintViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

export async function createPolicyRule(data: {
  documentId?: string;
  organizationId: string;
  code: string;
  title: string;
  body?: string;
  keywords?: string[];
  patterns?: string[];
  severity: RuleSeverity;
  category?: string;
  isManual?: boolean;
  status?: RuleStatus;
  detectorType?: RuleDetectorType;
  checksumKind?: string;
  dictionaryId?: string;
  action?: CompiledRuleAction;
  priority?: number;
  sourceQuote?: string;
  sourcePage?: number | null;
  textHash?: string;
  conflictGroup?: string;
  reviewNote?: string;
  chunkId?: string;
}): Promise<PolicyRule> {
  const status = data.status ?? 'ACTIVE';
  return db.policyRule.create({
    data: {
      documentId: data.documentId ?? null,
      organizationId: data.organizationId,
      code: data.code,
      title: data.title,
      body: data.body ?? null,
      keywords: JSON.stringify(data.keywords ?? []),
      patterns: JSON.stringify(data.patterns ?? []),
      severity: data.severity,
      category: data.category ?? null,
      isManual: data.isManual ?? false,
      status,
      detectorType: data.detectorType ?? 'SEMANTIC',
      checksumKind: data.checksumKind ?? null,
      dictionaryId: data.dictionaryId ?? null,
      action: data.action ?? 'BLOCK_EXTERNAL',
      priority: data.priority ?? 100,
      sourceQuote: data.sourceQuote ?? null,
      sourcePage: data.sourcePage ?? null,
      textHash: data.textHash ?? null,
      conflictGroup: data.conflictGroup ?? null,
      reviewNote: data.reviewNote ?? null,
      chunkId: data.chunkId ?? null,
      // status ⇔ isActive stay in lockstep for backward compatibility.
      isActive: status === 'ACTIVE',
    },
  });
}

/** Find an existing org rule with the same stable text hash (dedupe). */
export async function findRuleByTextHash(
  organizationId: string,
  textHash: string,
): Promise<PolicyRule | null> {
  return db.policyRule.findFirst({ where: { organizationId, textHash } });
}

export async function updatePolicyRule(
  id: string,
  data: Partial<{
    code: string;
    title: string;
    body: string | null;
    keywords: string[];
    patterns: string[];
    severity: RuleSeverity;
    category: string | null;
    isActive: boolean;
    isManual: boolean;
    status: RuleStatus;
    action: CompiledRuleAction;
    priority: number;
    reviewNote: string | null;
    conflictGroup: string | null;
    checksumKind: string | null;
    dictionaryId: string | null;
  }>,
): Promise<PolicyRule> {
  const existing = await db.policyRule.findUnique({ where: { id } });
  if (!existing) {
    throw new Error(`PolicyRule with id "${id}" not found`);
  }

  const updateData: Record<string, unknown> = { ...data };

  if (data.keywords !== undefined) {
    updateData.keywords = JSON.stringify(data.keywords);
  }
  if (data.patterns !== undefined) {
    updateData.patterns = JSON.stringify(data.patterns);
  }
  // status ⇔ isActive stay in lockstep for backward compatibility.
  if (data.status !== undefined) {
    updateData.isActive = data.status === 'ACTIVE';
  }
  if (data.isActive !== undefined && data.status === undefined) {
    updateData.status = data.isActive ? 'ACTIVE' : 'ARCHIVED';
  }

  return db.policyRule.update({
    where: { id },
    data: updateData,
  });
}

export async function deletePolicyRule(id: string, organizationId: string): Promise<void> {
  const rule = await db.policyRule.findFirst({ where: { id, organizationId } });
  if (!rule) {
    throw new Error(`PolicyRule with id "${id}" not found in organization "${organizationId}"`);
  }
  await db.policyRule.delete({ where: { id } });
}

/**
 * Reset a document's extraction artifacts for reprocessing:
 * deletes its chunks and its AUTO-extracted rules (isManual=false, bound to
 * this document). Manual rules and rules of other documents are untouched.
 * Returns how many chunks / rules were removed.
 */
export async function resetPolicyDocumentExtraction(documentId: string): Promise<{
  deletedChunks: number;
  deletedRules: number;
  deletedUnits: number;
  deletedConcepts: number;
}> {
  const deletedChunks = await db.policyChunk.deleteMany({ where: { documentId } });
  const deletedRules = await db.policyRule.deleteMany({
    where: { documentId, isManual: false },
  });
  const deletedUnits = await db.policyUnit.deleteMany({ where: { documentId } });
  const deletedConcepts = await db.policyConcept.deleteMany({
    where: { documentId, reviewStatus: { in: ['REVIEW', 'DRAFT'] } },
  });
  return {
    deletedChunks: deletedChunks.count,
    deletedRules: deletedRules.count,
    deletedUnits: deletedUnits.count,
    deletedConcepts: deletedConcepts.count,
  };
}

/**
 * Activation semantics for the rule runtime:
 * the LIVE policy = this document's rules + manual (admin-managed) rules.
 * AUTO-extracted rules of every OTHER document (incl. archived docs and
 * orphans with documentId=null) are deactivated so stale extractions — e.g.
 * rules from an older, text-corrupted upload — stop firing at runtime.
 */
export async function activatePolicyRulesForDocument(
  organizationId: string,
  documentId: string,
): Promise<{ activated: number; deactivated: number }> {
  const deactivated = await db.policyRule.updateMany({
    where: {
      organizationId,
      isManual: false,
      isActive: true,
      NOT: { documentId },
    },
    data: { isActive: false },
  });
  const activated = await db.policyRule.updateMany({
    where: { organizationId, documentId, isManual: false },
    data: { isActive: true },
  });
  return { activated: activated.count, deactivated: deactivated.count };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeParseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
