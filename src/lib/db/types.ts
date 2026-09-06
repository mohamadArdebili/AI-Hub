export type {
  PolicyDocument,
  PolicyChunk,
  PolicyRule,
  PolicyDecisionLog,
  ChatSession,
  ChatMessage,
  Organization,
  User,
  MaskDictionary,
} from '@prisma/client';
export type {
  PolicyDocumentStatus,
  RuleSeverity,
  PolicyAction,
  UserRole,
  MaskKind,
} from '@prisma/client';

// PolicySnapshot: what the engine needs for evaluation
export interface PolicySnapshot {
  rules: Array<{
    id: string;
    code: string;
    title: string;
    keywords: string[];
    patterns: string[];
    severity: string;
    category: string | null;
    isActive: boolean;
  }>;
  chunks: Array<{
    id: string;
    content: string;
    normalizedContent: string;
    isRestricted: boolean;
  }>;
}

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
  // ── Phase 3 audit fields ──
  route?: 'EXTERNAL' | 'LOCAL' | 'BLOCKED' | null;
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
}
