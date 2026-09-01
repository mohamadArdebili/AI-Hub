import { db } from './client';
import type { PolicyDocument, PolicyRule } from './types';
import type { PolicySnapshot } from './types';
import type { PolicyDocumentStatus, RuleSeverity } from '@prisma/client';

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
}): Promise<PolicyDocument> {
  return db.policyDocument.create({ data });
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
    data: { isActive: false },
  });

  return db.policyDocument.update({
    where: { id },
    data: { isActive: true },
  });
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
      severity: r.severity as string,
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
  }[],
): Promise<void> {
  await db.policyChunk.createMany({ data: chunks });
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
}): Promise<PolicyRule> {
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
    },
  });
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

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeParseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
