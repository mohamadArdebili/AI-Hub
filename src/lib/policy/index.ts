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
} from './types';
