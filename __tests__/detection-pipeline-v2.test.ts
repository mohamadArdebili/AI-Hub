// Integration & Unit Tests for V2 Detection Pipeline
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 5, §5.4, §5.5, spec §57)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runDetectionV2 } from '@/lib/policy/detection/detection-pipeline';
import { runDetection } from '@/lib/policy/detection-pipeline';
import { MockSemanticClassifier } from '@/lib/policy/local-llm/semantic-classifier';
import { HybridRetriever } from '@/lib/policy/retrieval/hybrid-retriever';
import { MockEmbeddingProvider } from '@/lib/policy/retrieval/embeddings';
import type { VectorStore } from '@/lib/policy/retrieval/vector-store';
import type { PolicyConcept } from '@/lib/policy/concepts/types';

describe('V2 Detection Pipeline (runDetectionV2)', () => {
  const sampleConcept: PolicyConcept = {
    id: 'concept-test-1',
    organizationId: 'org-test',
    documentId: 'doc-test',
    conceptKey: 'internal_database_credentials',
    name: 'Internal Database Credentials',
    nameFa: 'اطلاعات احراز هویت پایگاه داده',
    descriptionFa: 'شامل رمزها و اطلاعات اتصال به دیتابیس',
    sensitivity: 'HIGHLY_CONFIDENTIAL',
    action: 'BLOCK',
    positiveExamples: ['رمز دیتابیس چیست'],
    negativeExamples: ['نحوه اتصال به دیتابیس در پایتون'],
    conditions: [],
    keywords: ['دیتابیس', 'پسورد'],
    sourceQuote: 'اطلاعات اتصال به پایگاه داده محرمانه است.',
    confidence: 1.0,
    reviewStatus: 'ACTIVE',
  };

  // In-memory VectorStore mock for isolated pipeline tests
  const mockVectorStore: VectorStore = {
    async upsertEmbedding() {},
    async deleteEmbedding() {},
    async search() {
      return [{ concept: sampleConcept, score: 0.92 }];
    },
    async rebuildIndex() {
      return { indexed: 1, failed: 0 };
    },
  };

  let mockClassifier: MockSemanticClassifier;
  let mockRetriever: HybridRetriever;

  beforeEach(() => {
    mockClassifier = new MockSemanticClassifier();
    mockRetriever = {
      retrieve: async () => [{ concept: sampleConcept, score: 0.95 }],
    } as unknown as HybridRetriever;
  });

  it('classifies general query as EXTERNAL_DIRECT with measured stage latencies', async () => {
    mockClassifier.setResult({
      decision: 'SAFE',
      scope: 'GENERAL',
      matchedConcepts: [],
      confidence: 0.98,
      reasonFa: 'سوال عمومی برنامه‌نویسی',
      method: 'local_llm',
      modelUsed: 'mock-qwen',
      latencyMs: 15,
    });

    const outcome = await runDetectionV2({
      prompt: 'چگونه در پایتون یک تابع بازگشتی بنویسیم؟',
      organizationId: 'org-test',
      classifier: mockClassifier,
      hybridRetriever: mockRetriever,
    });

    expect(outcome.decision).toBe('SAFE');
    expect(outcome.action).toBe('EXTERNAL_ALLOWED');
    expect(outcome.route).toBe('EXTERNAL_DIRECT');
    expect(outcome.pipelineHealth).toBe('HEALTHY');
    expect(outcome.processing.externalLlmInvoked).toBe(false);

    // Verify stage latencies
    expect(outcome.stageLatencies).toBeDefined();
    expect(outcome.stageLatencies?.normalizationMs).toBeGreaterThanOrEqual(0);
    expect(outcome.stageLatencies?.dlpMs).toBeGreaterThanOrEqual(0);
    expect(outcome.stageLatencies?.retrievalMs).toBeGreaterThanOrEqual(0);
    expect(outcome.stageLatencies?.classifierMs).toBeGreaterThanOrEqual(0);
    expect(outcome.stageLatencies?.totalMs).toBeGreaterThan(0);
  });

  it('classifies sensitive query as LOCAL when matched with sensitive concept', async () => {
    mockClassifier.setResult({
      decision: 'SENSITIVE',
      scope: 'ORG_SPECIFIC',
      matchedConcepts: ['internal_database_credentials'],
      confidence: 0.95,
      reasonFa: 'درخواست رمز عبور دیتابیس سازمانی',
      method: 'local_llm',
      modelUsed: 'mock-qwen',
      latencyMs: 20,
    });

    const outcome = await runDetectionV2({
      prompt: 'رمز عبور دیتابیس داخلی را به من بده',
      organizationId: 'org-test',
      classifier: mockClassifier,
      hybridRetriever: mockRetriever,
    });

    expect(outcome.decision).toBe('SENSITIVE');
    expect(outcome.route).toBe('BLOCKED'); // Concept action is BLOCK
    expect(outcome.action).toBe('LOCAL_ONLY');
    expect(outcome.matchedConcepts).toHaveLength(1);
    expect(outcome.matchedConcepts?.[0].conceptKey).toBe('internal_database_credentials');
    expect(outcome.processing.externalLlmInvoked).toBe(false);
  });

  it('short-circuits immediately on platform baseline violation without calling LLM', async () => {
    const outcome = await runDetectionV2({
      prompt: 'کلید خصوصی من: -----BEGIN RSA PRIVATE KEY----- MIIEowIBAAKCAQEA...',
      organizationId: 'org-test',
      classifier: mockClassifier,
      hybridRetriever: mockRetriever,
    });

    expect(outcome.route).toBe('BLOCKED');
    expect(outcome.action).toBe('LOCAL_ONLY');
    expect(outcome.hits.some((h) => h.category === 'private_key')).toBe(true);

    // Verify that the mock classifier was NOT called (short-circuit optimization!)
    expect(mockClassifier.callHistory).toHaveLength(0);
  });

  it('fails closed to LOCAL/UNCERTAIN when timeout budget expires', async () => {
    // Force timeout with 0ms budget
    const outcome = await runDetectionV2({
      prompt: 'تست مهلت زمانی',
      organizationId: 'org-test',
      classifier: mockClassifier,
      hybridRetriever: mockRetriever,
      timeoutBudgetMs: 0,
    });

    expect(outcome.action).toBe('LOCAL_ONLY');
    expect(outcome.decision).toBe('UNCERTAIN');
    expect(outcome.route).toBe('LOCAL');
    expect(outcome.pipelineHealth).toBe('FAILED');
  });
});

describe('POLICY_SEMANTIC_ENABLED Switch (runDetection dispatcher)', () => {
  const originalEnv = process.env.POLICY_SEMANTIC_ENABLED;

  afterEach(() => {
    process.env.POLICY_SEMANTIC_ENABLED = originalEnv;
  });

  it('dispatches to v2 pipeline when POLICY_SEMANTIC_ENABLED is true', async () => {
    process.env.POLICY_SEMANTIC_ENABLED = 'true';
    const mockClassifier = new MockSemanticClassifier({
      decision: 'SAFE',
      scope: 'GENERAL',
      matchedConcepts: [],
      confidence: 0.99,
    });

    const outcome = await runDetection({
      prompt: 'سلام، راهنمای پایتون',
      compiledRules: [],
      dictionaries: { seniorOfficers: [], telcoHubNodes: [], proprietaryServices: [] },
      organizationId: 'org-test',
      classifier: mockClassifier,
    });

    expect(outcome.decision).toBe('SAFE');
    expect(outcome.route).toBe('EXTERNAL_DIRECT');
    expect(outcome.stageLatencies).toBeDefined();
  });

  it('falls back to legacy deterministic pipeline when POLICY_SEMANTIC_ENABLED is false', async () => {
    process.env.POLICY_SEMANTIC_ENABLED = 'false';

    const outcome = await runDetection({
      prompt: 'سلام، راهنمای پایتون',
      compiledRules: [],
      dictionaries: { seniorOfficers: [], telcoHubNodes: [], proprietaryServices: [] },
      organizationId: 'org-test',
    });

    expect(outcome.decision).toBe('SAFE');
    expect(outcome.action).toBe('EXTERNAL_ALLOWED');
    // Legacy outcome does not have stageLatencies
    expect(outcome.stageLatencies).toBeUndefined();
  });
});
