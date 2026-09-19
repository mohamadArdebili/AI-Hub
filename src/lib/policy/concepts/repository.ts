// Policy Concept Repository — Phase 1 Prisma Data Access Layer
// (MIGRATION_PLAN_REVIEWED_v1.1 §1.4, spec §7, §13, §71 Phase 1)

import crypto from 'crypto';
import { db } from '@/lib/db/client';
import type {
  ConceptSensitivity,
  ConceptAction as PrismaConceptAction,
  ConceptReviewStatus as PrismaConceptReviewStatus,
  PolicyUnitType as PrismaPolicyUnitType,
} from '@prisma/client';
import type {
  PolicyConcept,
  PolicyUnit,
  PolicyConceptSourceRef,
  PolicyConceptExampleRef,
  PolicyConceptEmbeddingRef,
  SensitivityLevel,
  ConceptAction,
  ConceptReviewStatus,
  PolicyUnitType,
  DetectorHints,
} from './types';

const CONCEPT_INCLUDE = {
  examples: true,
  sources: true,
  embedding: true,
  unit: {
    select: {
      sectionTitle: true,
      ordinal: true,
    },
  },
} as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

function safeParseJson<T>(val: string | null | undefined, fallback: T): T {
  if (!val) return fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

/**
 * Maps a raw Prisma PolicyConcept record with relations to the domain PolicyConcept interface.
 */
function toDomainConcept(record: any): PolicyConcept {
  const conditions = safeParseJson<string[]>(record.conditions, []);
  const keywords = safeParseJson<string[]>(record.keywords, []);
  const detectorHints = safeParseJson<DetectorHints | null>(record.detectorHints, null);
  const flags = (detectorHints as any)?.flags ?? [];

  const rawExamples: any[] = record.examples ?? [];
  const positiveExamples = rawExamples
    .filter((e) => e.kind === 'POSITIVE')
    .map((e) => e.text);
  const negativeExamples = rawExamples
    .filter((e) => e.kind === 'NEGATIVE')
    .map((e) => e.text);

  const examples: PolicyConceptExampleRef[] = rawExamples.map((e) => ({
    id: e.id,
    conceptId: e.conceptId,
    kind: e.kind,
    text: e.text,
    createdAt: e.createdAt,
  }));

  const sources: PolicyConceptSourceRef[] = (record.sources ?? []).map((s: any) => ({
    id: s.id,
    conceptId: s.conceptId,
    unitId: s.unitId,
    page: s.page,
    quote: s.quote,
    quoteHash: s.quoteHash,
    createdAt: s.createdAt,
  }));

  let embedding: PolicyConceptEmbeddingRef | null = null;
  if (record.embedding) {
    embedding = {
      id: record.embedding.id,
      conceptId: record.embedding.conceptId,
      vector: safeParseJson<number[]>(record.embedding.vector, []),
      model: record.embedding.model,
      dim: record.embedding.dim,
      textHash: record.embedding.textHash,
      updatedAt: record.embedding.updatedAt,
    };
  }

  return {
    id: record.id,
    organizationId: record.organizationId,
    documentId: record.documentId,
    unitId: record.unitId,
    sectionTitle: record.unit?.sectionTitle ?? null,
    conceptKey: record.conceptKey,
    name: record.name,
    nameFa: record.nameFa,
    descriptionFa: record.descriptionFa,
    category: record.category,
    sensitivity: record.sensitivity as SensitivityLevel,
    action: record.action as ConceptAction,
    positiveExamples,
    negativeExamples,
    conditions,
    keywords,
    detectorHints,
    flags,
    sourceQuote: record.sourceQuote,
    sourcePage: record.sourcePage,
    confidence: record.confidence,
    reviewStatus: record.reviewStatus as ConceptReviewStatus,
    extractedByModel: record.extractedByModel,
    reviewNote: record.reviewNote,
    textHash: record.textHash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    sources,
    examples,
    embedding,
  };
}

function toDomainUnit(record: any): PolicyUnit {
  return {
    id: record.id,
    documentId: record.documentId,
    ordinal: record.ordinal,
    page: record.page,
    sectionTitle: record.sectionTitle,
    text: record.text,
    normalizedText: record.normalizedText,
    unitType: record.unitType as PolicyUnitType,
    spanStart: record.spanStart,
    spanEnd: record.spanEnd,
    isCandidate: record.isCandidate,
    createdAt: record.createdAt,
    concepts: record.concepts ? record.concepts.map(toDomainConcept) : undefined,
    sources: record.sources
      ? record.sources.map((s: any) => ({
          id: s.id,
          conceptId: s.conceptId,
          unitId: s.unitId,
          page: s.page,
          quote: s.quote,
          quoteHash: s.quoteHash,
          createdAt: s.createdAt,
        }))
      : undefined,
  };
}

// ─── Concept Inputs ─────────────────────────────────────────────────────────

export interface CreateConceptInput {
  organizationId: string;
  documentId: string;
  unitId?: string | null;
  conceptKey: string;
  name: string;
  nameFa?: string | null;
  descriptionFa: string;
  category?: string | null;
  sensitivity: SensitivityLevel;
  action: ConceptAction;
  positiveExamples?: string[];
  negativeExamples?: string[];
  conditions?: string[];
  keywords?: string[];
  detectorHints?: DetectorHints | null;
  flags?: string[];
  sourceQuote: string;
  sourcePage?: number | null;
  confidence?: number;
  reviewStatus?: ConceptReviewStatus;
  extractedByModel?: string | null;
  reviewNote?: string | null;
  textHash?: string | null;
  sources?: Array<{
    unitId?: string | null;
    page?: number | null;
    quote: string;
  }>;
}

export interface UpdateConceptInput {
  name?: string;
  nameFa?: string | null;
  descriptionFa?: string;
  category?: string | null;
  sensitivity?: SensitivityLevel;
  action?: ConceptAction;
  positiveExamples?: string[];
  negativeExamples?: string[];
  conditions?: string[];
  keywords?: string[];
  detectorHints?: DetectorHints | null;
  sourceQuote?: string;
  sourcePage?: number | null;
  confidence?: number;
  reviewStatus?: ConceptReviewStatus;
  reviewNote?: string | null;
}

// ─── Concept CRUD ───────────────────────────────────────────────────────────

/**
 * Creates a new PolicyConcept in REVIEW status (by default) with examples and provenance sources.
 */
export async function createConcept(data: CreateConceptInput): Promise<PolicyConcept> {
  const hash = data.textHash ?? sha256(`${data.conceptKey}:${data.descriptionFa}`);
  const reviewStatus = (data.reviewStatus ?? 'REVIEW') as PrismaConceptReviewStatus;

  // Build example records
  const exampleRecords: Array<{ kind: 'POSITIVE' | 'NEGATIVE'; text: string }> = [
    ...(data.positiveExamples ?? []).map((text) => ({ kind: 'POSITIVE' as const, text })),
    ...(data.negativeExamples ?? []).map((text) => ({ kind: 'NEGATIVE' as const, text })),
  ];

  // Primary quote source
  const sourceQuotes = [...(data.sources ?? [])];
  if (data.sourceQuote && !sourceQuotes.some((s) => s.quote.trim() === data.sourceQuote.trim())) {
    sourceQuotes.unshift({
      unitId: data.unitId ?? null,
      page: data.sourcePage ?? null,
      quote: data.sourceQuote,
    });
  }

  const sourceRecords = sourceQuotes.map((s) => ({
    unitId: s.unitId ?? null,
    page: s.page ?? null,
    quote: s.quote,
    quoteHash: sha256(s.quote),
  }));

  const detectorHintsObj: DetectorHints = {
    ...(data.detectorHints || {}),
  };
  if (data.flags && data.flags.length > 0) {
    detectorHintsObj.flags = data.flags;
  }
  const serializedDetectorHints =
    Object.keys(detectorHintsObj).length > 0 ? JSON.stringify(detectorHintsObj) : null;

  const created = await db.policyConcept.create({
    data: {
      organizationId: data.organizationId,
      documentId: data.documentId,
      unitId: data.unitId ?? null,
      conceptKey: data.conceptKey,
      name: data.name,
      nameFa: data.nameFa ?? null,
      descriptionFa: data.descriptionFa,
      category: data.category ?? null,
      sensitivity: data.sensitivity as ConceptSensitivity,
      action: data.action as PrismaConceptAction,
      conditions: JSON.stringify(data.conditions ?? []),
      keywords: JSON.stringify(data.keywords ?? []),
      detectorHints: serializedDetectorHints,
      sourceQuote: data.sourceQuote,
      sourcePage: data.sourcePage ?? null,
      confidence: data.confidence ?? 0,
      reviewStatus,
      extractedByModel: data.extractedByModel ?? null,
      reviewNote: data.reviewNote ?? null,
      textHash: hash,
      examples: {
        create: exampleRecords,
      },
      sources: {
        create: sourceRecords,
      },
    },
    include: CONCEPT_INCLUDE,
  });

  return toDomainConcept(created);
}

/**
 * Retrieves a concept by its unique ID.
 */
export async function getConceptById(
  id: string,
  organizationId?: string,
): Promise<PolicyConcept | null> {
  const where: any = { id };
  if (organizationId) {
    where.organizationId = organizationId;
  }

  const record = await db.policyConcept.findFirst({
    where,
    include: CONCEPT_INCLUDE,
  });

  return record ? toDomainConcept(record) : null;
}

/**
 * Retrieves a concept by documentId and conceptKey.
 */
export async function getConceptByKey(
  organizationId: string,
  documentId: string,
  conceptKey: string,
): Promise<PolicyConcept | null> {
  const record = await db.policyConcept.findUnique({
    where: {
      documentId_conceptKey: { documentId, conceptKey },
    },
    include: CONCEPT_INCLUDE,
  });

  if (!record || record.organizationId !== organizationId) {
    return null;
  }

  return toDomainConcept(record);
}

/**
 * Lists concepts for an organization with optional filtering.
 */
export async function listConcepts(
  organizationId: string,
  filter?: {
    documentId?: string;
    reviewStatus?: ConceptReviewStatus;
    sensitivity?: SensitivityLevel;
  },
): Promise<PolicyConcept[]> {
  const where: any = { organizationId };

  if (filter?.documentId) where.documentId = filter.documentId;
  if (filter?.reviewStatus) where.reviewStatus = filter.reviewStatus;
  if (filter?.sensitivity) where.sensitivity = filter.sensitivity;

  const records = await db.policyConcept.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: CONCEPT_INCLUDE,
  });

  return records.map(toDomainConcept);
}

/**
 * Crucial runtime retrieval contract: returns ONLY ACTIVE concepts (spec §16).
 * Draft or unreviewed concepts are strictly excluded from runtime detection.
 */
export async function getActiveConcepts(
  organizationId: string,
  options?: { documentId?: string; onlyActiveDocument?: boolean },
): Promise<PolicyConcept[]> {
  const where: any = {
    organizationId,
    reviewStatus: 'ACTIVE' as PrismaConceptReviewStatus,
  };

  if (options?.documentId) {
    where.documentId = options.documentId;
  } else if (options?.onlyActiveDocument) {
    where.document = { isActive: true, lifecycle: 'ACTIVE' };
  }

  const records = await db.policyConcept.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: CONCEPT_INCLUDE,
  });

  return records.map(toDomainConcept);
}

/**
 * Approves a concept, transitioning it to ACTIVE status (spec §13).
 */
export async function approveConcept(
  id: string,
  organizationId: string,
  reviewNote?: string,
): Promise<PolicyConcept> {
  const existing = await getConceptById(id, organizationId);
  if (!existing) {
    throw new Error(`PolicyConcept with id "${id}" not found in organization "${organizationId}"`);
  }

  const updated = await db.policyConcept.update({
    where: { id },
    data: {
      reviewStatus: 'ACTIVE' as PrismaConceptReviewStatus,
      reviewNote: reviewNote !== undefined ? reviewNote : existing.reviewNote,
    },
    include: CONCEPT_INCLUDE,
  });

  return toDomainConcept(updated);
}

/**
 * Rejects a concept, transitioning it to REJECTED status (spec §13).
 */
export async function rejectConcept(
  id: string,
  organizationId: string,
  reviewNote?: string,
): Promise<PolicyConcept> {
  const existing = await getConceptById(id, organizationId);
  if (!existing) {
    throw new Error(`PolicyConcept with id "${id}" not found in organization "${organizationId}"`);
  }

  const updated = await db.policyConcept.update({
    where: { id },
    data: {
      reviewStatus: 'REJECTED' as PrismaConceptReviewStatus,
      reviewNote: reviewNote !== undefined ? reviewNote : existing.reviewNote,
    },
    include: CONCEPT_INCLUDE,
  });

  return toDomainConcept(updated);
}

/**
 * Archives a concept, transitioning it to ARCHIVED status.
 */
export async function archiveConcept(id: string, organizationId: string): Promise<PolicyConcept> {
  const existing = await getConceptById(id, organizationId);
  if (!existing) {
    throw new Error(`PolicyConcept with id "${id}" not found in organization "${organizationId}"`);
  }

  const updated = await db.policyConcept.update({
    where: { id },
    data: {
      reviewStatus: 'ARCHIVED' as PrismaConceptReviewStatus,
    },
    include: CONCEPT_INCLUDE,
  });

  return toDomainConcept(updated);
}

/**
 * Updates a concept's metadata or examples.
 */
export async function updateConcept(
  id: string,
  organizationId: string,
  data: UpdateConceptInput,
): Promise<PolicyConcept> {
  const existing = await getConceptById(id, organizationId);
  if (!existing) {
    throw new Error(`PolicyConcept with id "${id}" not found in organization "${organizationId}"`);
  }

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.nameFa !== undefined) updateData.nameFa = data.nameFa;
  if (data.descriptionFa !== undefined) updateData.descriptionFa = data.descriptionFa;
  if (data.category !== undefined) updateData.category = data.category;
  if (data.sensitivity !== undefined) updateData.sensitivity = data.sensitivity as ConceptSensitivity;
  if (data.action !== undefined) updateData.action = data.action as PrismaConceptAction;
  if (data.conditions !== undefined) updateData.conditions = JSON.stringify(data.conditions);
  if (data.keywords !== undefined) updateData.keywords = JSON.stringify(data.keywords);
  if (data.detectorHints !== undefined) {
    updateData.detectorHints = data.detectorHints ? JSON.stringify(data.detectorHints) : null;
  }
  if (data.sourceQuote !== undefined) updateData.sourceQuote = data.sourceQuote;
  if (data.sourcePage !== undefined) updateData.sourcePage = data.sourcePage;
  if (data.confidence !== undefined) updateData.confidence = data.confidence;
  if (data.reviewStatus !== undefined) updateData.reviewStatus = data.reviewStatus as PrismaConceptReviewStatus;
  if (data.reviewNote !== undefined) updateData.reviewNote = data.reviewNote;

  // Handle examples update if provided
  if (data.positiveExamples !== undefined || data.negativeExamples !== undefined) {
    const pos = data.positiveExamples ?? existing.positiveExamples;
    const neg = data.negativeExamples ?? existing.negativeExamples;
    await db.policyConceptExample.deleteMany({ where: { conceptId: id } });
    await db.policyConceptExample.createMany({
      data: [
        ...pos.map((t) => ({ conceptId: id, kind: 'POSITIVE', text: t })),
        ...neg.map((t) => ({ conceptId: id, kind: 'NEGATIVE', text: t })),
      ],
    });
  }

  const updated = await db.policyConcept.update({
    where: { id },
    data: updateData,
    include: CONCEPT_INCLUDE,
  });

  return toDomainConcept(updated);
}

/**
 * Permanently deletes a concept and cascades to examples, sources, and embedding.
 */
export async function deleteConcept(id: string, organizationId: string): Promise<void> {
  const existing = await getConceptById(id, organizationId);
  if (!existing) {
    throw new Error(`PolicyConcept with id "${id}" not found in organization "${organizationId}"`);
  }

  await db.policyConcept.delete({ where: { id } });
}

/**
 * Adds an additional provenance source quote to a concept.
 */
export async function addConceptSource(
  conceptId: string,
  source: { quote: string; unitId?: string | null; page?: number | null },
): Promise<PolicyConceptSourceRef> {
  const quoteHash = sha256(source.quote);

  const created = await db.policyConceptSource.upsert({
    where: {
      conceptId_quoteHash: { conceptId, quoteHash },
    },
    create: {
      conceptId,
      unitId: source.unitId ?? null,
      page: source.page ?? null,
      quote: source.quote,
      quoteHash,
    },
    update: {
      unitId: source.unitId ?? null,
      page: source.page ?? null,
      quote: source.quote,
    },
  });

  return {
    id: created.id,
    conceptId: created.conceptId,
    unitId: created.unitId,
    page: created.page,
    quote: created.quote,
    quoteHash: created.quoteHash,
    createdAt: created.createdAt,
  };
}

// ─── PolicyUnit CRUD ────────────────────────────────────────────────────────

export interface CreatePolicyUnitInput {
  documentId: string;
  ordinal: number;
  page?: number | null;
  sectionTitle?: string | null;
  text: string;
  normalizedText: string;
  unitType: PolicyUnitType;
  spanStart: number;
  spanEnd: number;
  isCandidate?: boolean;
}

export async function createPolicyUnits(units: CreatePolicyUnitInput[]): Promise<PolicyUnit[]> {
  if (units.length === 0) return [];

  // Create units sequentially or with createMany and then query
  await db.policyUnit.createMany({
    data: units.map((u) => ({
      documentId: u.documentId,
      ordinal: u.ordinal,
      page: u.page ?? null,
      sectionTitle: u.sectionTitle ?? null,
      text: u.text,
      normalizedText: u.normalizedText,
      unitType: u.unitType as PrismaPolicyUnitType,
      spanStart: u.spanStart,
      spanEnd: u.spanEnd,
      isCandidate: u.isCandidate ?? false,
    })),
  });

  const documentId = units[0].documentId;
  const records = await db.policyUnit.findMany({
    where: { documentId },
    orderBy: { ordinal: 'asc' },
  });

  return records.map(toDomainUnit);
}

export async function getPolicyUnitsByDocument(documentId: string): Promise<PolicyUnit[]> {
  const records = await db.policyUnit.findMany({
    where: { documentId },
    orderBy: { ordinal: 'asc' },
    include: {
      concepts: {
        include: { examples: true, sources: true, embedding: true },
      },
      sources: true,
    },
  });

  return records.map(toDomainUnit);
}

export async function getPolicyUnitById(id: string): Promise<PolicyUnit | null> {
  const record = await db.policyUnit.findUnique({
    where: { id },
    include: {
      concepts: {
        include: { examples: true, sources: true, embedding: true },
      },
      sources: true,
    },
  });

  return record ? toDomainUnit(record) : null;
}
