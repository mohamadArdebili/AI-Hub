// Policy Concept Types — Phase 1 Semantic Architecture
// (MIGRATION_PLAN_REVIEWED_v1.1 §1.2, §3.2, §4.4)

export type SensitivityLevel =
  | 'PUBLIC'
  | 'INTERNAL'
  | 'CONFIDENTIAL'
  | 'HIGHLY_CONFIDENTIAL';

export type ConceptAction =
  | 'ALLOW_EXTERNAL'
  | 'ROUTE_LOCAL'
  | 'MASK_AND_ALLOW_EXTERNAL'
  | 'BLOCK';

export type ConceptReviewStatus =
  | 'DRAFT'
  | 'REVIEW'
  | 'ACTIVE'
  | 'ARCHIVED'
  | 'REJECTED';

export type PolicyUnitType =
  | 'HEADING'
  | 'PARAGRAPH'
  | 'BULLET_GROUP'
  | 'TABLE'
  | 'CLAUSE';

export interface DetectorHints {
  regex?: string[];
  checksum?: string[];
  dictionary?: string[];
}

export interface PolicyConceptSourceRef {
  id?: string;
  conceptId?: string;
  unitId?: string | null;
  page?: number | null;
  quote: string;
  quoteHash?: string;
  createdAt?: Date;
}

export interface PolicyConceptExampleRef {
  id?: string;
  conceptId?: string;
  kind: 'POSITIVE' | 'NEGATIVE';
  text: string;
  createdAt?: Date;
}

export interface PolicyConceptEmbeddingRef {
  id?: string;
  conceptId: string;
  vector: number[];
  model: string;
  dim: number;
  textHash: string;
  updatedAt?: Date;
}

/**
 * Core Policy Concept entity (spec §7).
 * Unlike legacy keyword bag rules, a PolicyConcept captures structured semantic meaning,
 * explicit positive/negative examples, provenance quotes, and action precedence.
 */
export interface PolicyConcept {
  id: string;
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
  positiveExamples: string[];
  negativeExamples: string[];
  conditions: string[];
  keywords: string[]; // hint only, not detection mechanism
  detectorHints?: DetectorHints | null;
  sourceQuote: string; // mandatory primary provenance quote
  sourcePage?: number | null;
  confidence: number;
  reviewStatus: ConceptReviewStatus;
  extractedByModel?: string | null;
  reviewNote?: string | null;
  textHash?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
  sources?: PolicyConceptSourceRef[];
  examples?: PolicyConceptExampleRef[];
  embedding?: PolicyConceptEmbeddingRef | null;
}

/**
 * Structural semantic unit emitted by the segmenter (spec §11).
 */
export interface PolicyUnit {
  id: string;
  documentId: string;
  ordinal: number;
  page?: number | null;
  sectionTitle?: string | null;
  text: string;
  normalizedText: string;
  unitType: PolicyUnitType;
  spanStart: number;
  spanEnd: number;
  isCandidate: boolean;
  createdAt?: Date;
  concepts?: PolicyConcept[];
  sources?: PolicyConceptSourceRef[];
}

/**
 * Retrieved concept candidate scored during hybrid retrieval (spec §56).
 */
export interface RetrievedConcept {
  concept: PolicyConcept;
  score: number;
  denseScore?: number;
  lexicalScore?: number;
  rrfScore?: number;
}

/**
 * Concrete match evidence produced by semantic classification or fusion.
 */
export interface PolicyConceptMatch {
  conceptId: string;
  conceptKey: string;
  name: string;
  sensitivity: SensitivityLevel;
  action: ConceptAction;
  score: number;
  matchedText?: string;
  reason?: string;
}
