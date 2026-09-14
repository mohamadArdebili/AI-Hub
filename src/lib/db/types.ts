export type {
  PolicyDocument,
  PolicyChunk,
  PolicyRule,
  PolicyDecisionLog,
  PolicyAuditLog,
  ChatSession,
  ChatMessage,
  Organization,
  User,
  MaskDictionary,
  PolicyUnit,
  PolicyConcept,
  PolicyConceptSource,
  PolicyConceptExample,
  PolicyConceptEmbedding,
} from '@prisma/client';
export type {
  PolicyDocumentStatus,
  RuleSeverity,
  PolicyAction,
  UserRole,
  MaskKind,
  PolicyLifecycle,
  RuleStatus,
  RuleDetectorType,
  CompiledRuleAction,
  ConceptSensitivity,
  ConceptAction,
  ConceptReviewStatus,
  PolicyUnitType,
} from '@prisma/client';

// PolicySnapshot — single source of truth is the policy engine's strict type.
export type { PolicySnapshot } from '@/lib/policy/types';

// Log entry for decision logs
export interface DecisionLogEntry {
  userId: string;
  organizationId: string;
  action: 'ALLOW' | 'BLOCK';
  score: number;
  reasons: string[];
  matchedRuleIds: string[];
  promptHash: string;
  promptPreview: string;
  promptLength: number;
  latencyMs: number;
  engineVersion: string;
  // ── Phase 3 & 5 audit fields ──
  route?: 'EXTERNAL' | 'LOCAL' | 'BLOCKED' | string | null;
  maskCount?: number;
  maskLabels?: Array<{ label: string; count: number }>;
  isSensitive?: boolean | null;
  classifierCategory?: string | null;
  classifierRisk?: string | null;
  classifierReason?: string | null;
  classifierLatencyMs?: number | null;
  sourceIp?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  // ── Phase 1 / Semantic Pipeline audit fields (spec §37) ──
  sensitivity?: string | null;
  matchedConceptIds?: string[];
  retrievalScores?: Array<{ conceptId: string; score: number }> | string | null;
  classifierMethod?: string | null;
  egressMode?: string | null;
  policyVersion?: number | null;
  pipelineHealth?: string | null;
}
