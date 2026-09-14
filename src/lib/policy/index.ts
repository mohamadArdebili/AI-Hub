// Policy Engine — barrel export

export { normalizePersian } from './normalize';
export { evaluate } from './engine';
export {
  detectSensitiveData,
  detectKeywordRules,
  computeBM25,
  detectSimilarity,
  detectBehavioralPatterns,
} from './detectors';

export type {
  RuleInput,
  ChunkInput,
  PolicySnapshot,
  MatchedRule,
  DetectionResult,
  PolicyDecision,
  SensitivityDecision,
  RuntimeAction,
  RuleStatus,
  DetectorType,
  ChecksumKind,
  CompiledRuleAction,
  DetectionHit,
  DetectionProcessingMeta,
  DetectionOutcome,
  CompiledPolicyRule,
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
} from './types';

// Concepts module exports
export * from './concepts/types';
export * from './concepts/validator';
export * from './concepts/repository';

// Retrieval module exports (Phase 3)
export * from './retrieval/embeddings';
export * from './retrieval/vector-store';
export * from './retrieval/semantic-retriever';
export * from './retrieval/hybrid-retriever';


