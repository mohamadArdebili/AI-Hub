// Policy Engine Types — standalone, no Next.js imports

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
