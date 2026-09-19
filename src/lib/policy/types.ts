// Policy Engine Types — standalone, no Next.js imports

import type { SensitivityLevel, ConceptAction, PolicyConceptMatch } from './concepts/types';

export type {
  SensitivityLevel,
  ConceptAction,
  ConceptReviewStatus,
  PolicyUnitType,
  DetectorHints,
  PolicyConceptSourceRef,
  PolicyConceptExampleRef,
  PolicyConceptEmbeddingRef,
  PolicyConcept,
  PolicyUnit,
  RetrievedConcept,
  PolicyConceptMatch,
} from './concepts/types';

export interface RuleInput {
  id: string;
  code: string;
  title: string;
  keywords: string[];
  patterns: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: string | null;
  isActive: boolean;
}

export interface ChunkInput {
  id: string;
  content: string;
  normalizedContent: string;
  isRestricted: boolean;
}

export interface PolicySnapshot {
  rules: RuleInput[];
  chunks: ChunkInput[];
}

export interface MatchedRule {
  code: string;
  title: string;
  severity: string;
}

export interface DetectionResult {
  blocked: boolean;
  reasons: string[];
  matchedRules: MatchedRule[];
  score: number;
}

export interface PolicyDecision {
  action: 'ALLOW' | 'BLOCK';
  reasons: string[];
  matchedRules: MatchedRule[];
  score: number;
  latencyMs: number;
  engineVersion: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sensitive-Data Layer — runtime detection contracts
//
// Naming note: the prompt's proposed `PolicyDecision` (SAFE/SENSITIVE/
// UNCERTAIN) and `DetectionResult` (pipeline output) clash with the existing
// engine types above, so they are exported here as `SensitivityDecision` and
// `DetectionOutcome` respectively. Semantics are exactly as specified.
// ═══════════════════════════════════════════════════════════════════════════

/** Final sensitivity classification (prompt §2.1 `PolicyDecision`). */
export type SensitivityDecision = 'SAFE' | 'SENSITIVE' | 'UNCERTAIN';

/** Runtime routing action (prompt §2.1). */
export type RuntimeAction = 'EXTERNAL_ALLOWED' | 'LOCAL_ONLY';

/** Rule review lifecycle (prompt §2.1 `RuleStatus`). */
export type RuleStatus =
  | 'DRAFT'
  | 'REVIEW'
  | 'ACTIVE'
  | 'ARCHIVED'
  | 'REJECTED'
  | 'PENDING_LLM';

/** Deterministic detector kinds (prompt §2.1 `DetectorType`). */
export type DetectorType = 'REGEX' | 'CHECKSUM' | 'DICTIONARY' | 'SEMANTIC';

/** Checksum algorithms with a real mathematical validation. */
export type ChecksumKind = 'IR_NATIONAL_ID' | 'IR_BANK_CARD' | 'IBAN';

/** Actions a compiled rule can trigger at runtime (prompt §2.1). */
export type CompiledRuleAction = 'BLOCK_EXTERNAL' | 'MASK' | 'FLAG_REVIEW';

export interface DetectionHit {
  detectorType: DetectorType;
  /** null for builtin detectors (no DB rule backing). */
  ruleId: string | null;
  ruleLabel?: string;
  matchedSpan: { start: number; end: number; text: string };
  /** 0..1 — >= 0.85 → SENSITIVE, 0.5..0.85 → UNCERTAIN (fail-closed). */
  confidence: number;
  /** e.g. 'national_id' | 'ir_bank_card' | 'iban' | 'phone' | 'jailbreak' | rule category */
  category: string;
  sourceRef?: { documentId: string; chunkId?: string; page?: number };
}

export interface DetectionProcessingMeta {
  /** sha256 of the normalized input — never the raw text. */
  normalizedInputHash: string;
  /** Hash of the exact serialized outgoing messages. */
  egressPayloadHash?: string;
  durationMs: number;
  /** always false in this phase (Local LLM answering is a later phase). */
  localLlmUsed: boolean;
  /** always false — contractual guard flag for the detection pipeline. */
  externalLlmInvoked: false;
}

/** Output of the runtime detection pipeline (prompt §2.1 `DetectionResult`). */
export interface DetectionOutcome {
  decision: SensitivityDecision;
  /** SAFE → EXTERNAL_ALLOWED, otherwise LOCAL_ONLY (fail-closed). */
  action: RuntimeAction;
  hits: DetectionHit[];
  processing: DetectionProcessingMeta;
  /** Persian, human-readable summary for the local-route notice. */
  reason?: string;

  // ── Phase 1 extensions (optional / backward-compatible — spec §61) ──
  sensitivity?: SensitivityLevel;
  matchedConcepts?: PolicyConceptMatch[];
  classifier?: {
    method: 'local_llm' | 'deterministic' | 'heuristic' | 'fallback';
    confidence: number;
    reason?: string;
    reasonFa?: string;
    modelUsed?: string;
    scope?: string;
    decision?: string;
  };

  // ── Phase 5/6 extensions (spec §57, §71 Phase 5/6, spec §36) ──
  route?: 'EXTERNAL_DIRECT' | 'EXTERNAL_MASKED' | 'LOCAL' | 'BLOCKED';
  pipelineHealth?: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  policyVersion?: number;
  policyDocumentId?: string;
  policyRevision?: string;
  retrievedConcepts?: Array<{
    conceptId: string;
    conceptKey: string;
    name: string;
    category?: string | null;
    sensitivity: SensitivityLevel;
    action: ConceptAction;
    score: number;
    denseScore?: number;
    lexicalScore?: number;
    rrfScore?: number;
  }>;
  stageLatencies?: {
    normalizationMs: number;
    dlpMs: number;
    retrievalMs: number;
    classifierMs: number;
    fusionMs: number;
    decisionMs: number;
    totalMs: number;
  };
}

/** Runtime-optimized compiled rule (prompt §2.1 `CompiledPolicyRule`). */
export interface CompiledPolicyRule {
  id: string;
  detectorType: DetectorType;
  /** Populated only when detectorType === 'REGEX' — pre-compiled at runtime. */
  regex?: { source: string; flags: string };
  /** Populated only when detectorType === 'CHECKSUM'. */
  checksumKind?: ChecksumKind | string;
  /** Populated only when detectorType === 'DICTIONARY'. */
  dictionaryId?: string;
  /** Populated only when detectorType === 'SEMANTIC'. */
  semantic?: { keywords: string[]; scope: string[]; weight: number };
  action: CompiledRuleAction;
  /** lower = higher priority. */
  priority: number;
  source: { documentId: string; chunkId?: string; page?: number; quote: string };
}
