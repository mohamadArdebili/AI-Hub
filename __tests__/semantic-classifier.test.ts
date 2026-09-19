// Unit & Integration Tests for Local LLM Semantic Policy Classifier
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 4, §4.1-§4.5, spec §23, §24, §27, §28, §44)

import { describe, it, expect } from 'vitest';
import { OllamaClient, type LocalLlmTransport } from '@/lib/policy/local-llm/ollama-client';
import {
  OllamaSemanticPolicyClassifier,
  MockSemanticClassifier,
  extractJsonString,
  parseSemanticClassifierResponse,
  buildSemanticClassifierPrompt,
  type SemanticConceptCandidate,
} from '@/lib/policy/local-llm/semantic-classifier';
import { evaluateSemanticClassifier } from '@/lib/policy/local-llm/eval-classifier';
import evalSetData from '@/../eval/classifier-eval-set.json';

describe('Local LLM Semantic Policy Classifier', () => {
  const sampleCandidate: SemanticConceptCandidate = {
    conceptKey: 'server_private_keys',
    name: 'Server Private Keys',
    nameFa: 'کلیدهای خصوصی سرورها',
    descriptionFa: 'کلیدهای دسترسی SSH و رمزهای عبور سرورهای داخلی سازمان',
    sensitivity: 'HIGHLY_CONFIDENTIAL',
    action: 'BLOCK',
    positiveExamples: ['کلید ssh سرور اصلی را بده', 'رمز عبور روت سرور ابری'],
    negativeExamples: ['مفهوم کلید خصوصی و عمومی در رمزنگاری نامتقارن چیست؟'],
  };

  describe('Prompt Construction & JSON parsing', () => {
    it('builds prompt containing candidate details and negative examples', () => {
      const prompt = buildSemanticClassifierPrompt('متن کاربر', [sampleCandidate]);
      expect(prompt).toContain('server_private_keys');
      expect(prompt).toContain('کلیدهای خصوصی سرورها');
      expect(prompt).toContain('Positive Examples');
      expect(prompt).toContain('Negative Examples');
      expect(prompt).toContain('متن کاربر');
    });

    it('extracts JSON string when wrapped in markdown code blocks or surrounding text', () => {
      const withFences = '```json\n{"decision": "SAFE", "scope": "GENERAL", "matchedConcepts": [], "confidence": 0.9, "reasonFa": "تست"}\n```';
      expect(extractJsonString(withFences)).toBe(
        '{"decision": "SAFE", "scope": "GENERAL", "matchedConcepts": [], "confidence": 0.9, "reasonFa": "تست"}',
      );

      const withPreamble = 'پاسخ ارزیابی به شرح زیر است:\n{"decision": "SENSITIVE", "scope": "ORG_SPECIFIC", "matchedConcepts": ["server_private_keys"], "confidence": 0.95, "reasonFa": "حساس"}\nامیدوارم مفید باشد.';
      expect(extractJsonString(withPreamble)).toBe(
        '{"decision": "SENSITIVE", "scope": "ORG_SPECIFIC", "matchedConcepts": ["server_private_keys"], "confidence": 0.95, "reasonFa": "حساس"}',
      );
    });

    it('parses and normalizes valid JSON response with schema coercion', () => {
      const raw = JSON.stringify({
        decision: 'sensitive',
        scope: 'org_specific',
        matchedConcepts: 'server_private_keys', // single string coerced to array
        confidence: '0.98', // string coerced to number
        reasonFa: 'درخواست کلید سرور',
      });

      const parsed = parseSemanticClassifierResponse(raw);
      expect(parsed).not.toBeNull();
      expect(parsed?.decision).toBe('SENSITIVE');
      expect(parsed?.scope).toBe('ORG_SPECIFIC');
      expect(parsed?.matchedConcepts).toEqual(['server_private_keys']);
      expect(parsed?.confidence).toBe(0.98);
      expect(parsed?.reasonFa).toBe('درخواست کلید سرور');
    });

    it('returns null for completely invalid / non-JSON responses', () => {
      expect(parseSemanticClassifierResponse('سلام، من هوش مصنوعی هستم.')).toBeNull();
    });
  });

  describe('OllamaSemanticPolicyClassifier with Mock Transport', () => {
    it('classifies sensitive prompt matching candidate concept', async () => {
      const mockTransport: LocalLlmTransport = {
        async getJson() {
          return { status: 200, json: { models: [{ name: 'qwen3:1.7b' }] } };
        },
        async postJson() {
          return {
            status: 200,
            json: {
              response: JSON.stringify({
                decision: 'SENSITIVE',
                scope: 'ORG_SPECIFIC',
                matchedConcepts: ['server_private_keys'],
                confidence: 0.95,
                reasonFa: 'کاربر درخواست کلید خصوصی سرور کرده است.',
              }),
            },
          };
        },
      };

      const client = new OllamaClient(mockTransport, { enabled: true, model: 'qwen3:1.7b' });
      const classifier = new OllamaSemanticPolicyClassifier(client, { verifyMatches: false });

      const result = await classifier.classify({
        prompt: 'کلید خصوصی سرور SSH اصلی را برای من ارسال کن',
        candidateConcepts: [sampleCandidate],
      });

      expect(result.decision).toBe('SENSITIVE');
      expect(result.scope).toBe('ORG_SPECIFIC');
      expect(result.matchedConcepts).toEqual(['server_private_keys']);
      expect(result.confidence).toBe(0.95);
      expect(result.method).toBe('local_llm');
      expect(result.modelUsed).toBe('qwen3:1.7b');
      expect(result.error).toBeUndefined();
    });

    it('filters out hallucinated concepts that were not in candidates', async () => {
      const mockTransport: LocalLlmTransport = {
        async getJson() {
          return { status: 200, json: { models: [{ name: 'qwen3:1.7b' }] } };
        },
        async postJson() {
          return {
            status: 200,
            json: {
              response: JSON.stringify({
                decision: 'SENSITIVE',
                scope: 'ORG_SPECIFIC',
                matchedConcepts: ['server_private_keys', 'hallucinated_concept_xyz'],
                confidence: 0.85,
                reasonFa: 'شامل موارد حساس',
              }),
            },
          };
        },
      };

      const client = new OllamaClient(mockTransport, { enabled: true, model: 'qwen3:1.7b' });
      const classifier = new OllamaSemanticPolicyClassifier(client, { verifyMatches: false });

      const result = await classifier.classify({
        prompt: 'کلید خصوصی را ارسال کن',
        candidateConcepts: [sampleCandidate],
      });

      // An invented key invalidates the classification, not just that one match.
      expect(result.matchedConcepts).toEqual([]);
      expect(result.decision).toBe('UNCERTAIN');
    });

    it('fails closed to UNCERTAIN when Ollama is disabled or unreachable (spec §27)', async () => {
      const disabledClient = new OllamaClient(undefined, { enabled: false });
      const classifier = new OllamaSemanticPolicyClassifier(disabledClient);

      const result = await classifier.classify({
        prompt: 'تست ساده',
        candidateConcepts: [sampleCandidate],
      });

      expect(result.decision).toBe('UNCERTAIN');
      expect(result.scope).toBe('UNKNOWN');
      expect(result.confidence).toBe(0);
      expect(result.method).toBe('fallback');
      expect(result.error).toBe('DISABLED_BY_ENV');
    });

    it('fails closed to UNCERTAIN when Ollama returns network error or timeout', async () => {
      const mockTransport: LocalLlmTransport = {
        async getJson() {
          return { status: 200, json: { models: [{ name: 'qwen3:1.7b' }] } };
        },
        async postJson() {
          throw new Error('Connection timeout after 5000ms');
        },
      };

      const client = new OllamaClient(mockTransport, { enabled: true });
      const classifier = new OllamaSemanticPolicyClassifier(client, { verifyMatches: false });

      const result = await classifier.classify({
        prompt: 'تست ساده',
        candidateConcepts: [sampleCandidate],
      });

      expect(result.decision).toBe('UNCERTAIN');
      expect(result.scope).toBe('UNKNOWN');
      expect(result.method).toBe('fallback');
      expect(result.error).toContain('Connection timeout');
    });

    it('fails closed to UNCERTAIN when Ollama returns corrupted / non-JSON output', async () => {
      const mockTransport: LocalLlmTransport = {
        async getJson() {
          return { status: 200, json: { models: [{ name: 'qwen3:1.7b' }] } };
        },
        async postJson() {
          return {
            status: 200,
            json: { response: 'متاسفانه نمی‌توانم این درخواست را انجام دهم.' },
          };
        },
      };

      const client = new OllamaClient(mockTransport, { enabled: true });
      const classifier = new OllamaSemanticPolicyClassifier(client, { verifyMatches: false });

      const result = await classifier.classify({
        prompt: 'تست ساده',
        candidateConcepts: [sampleCandidate],
      });

      expect(result.decision).toBe('UNCERTAIN');
      expect(result.scope).toBe('UNKNOWN');
      expect(result.method).toBe('fallback');
      expect(result.error).toBe('INVALID_JSON_RESPONSE');
    });
  });

  describe('MockSemanticClassifier', () => {
    it('allows mocking deterministic decisions and tracks call history', async () => {
      const mock = new MockSemanticClassifier();
      expect(mock.callHistory).toHaveLength(0);

      const res1 = await mock.classify({
        prompt: 'کد پایتون برای مرتب‌سازی',
        candidateConcepts: [],
      });
      expect(res1.decision).toBe('SAFE');
      expect(mock.callHistory).toHaveLength(1);

      // Custom handler
      mock.setHandler((input) => {
        if (input.prompt.includes('پسورد')) {
          return {
            decision: 'SENSITIVE',
            scope: 'ORG_SPECIFIC',
            matchedConcepts: ['auth_credentials'],
            confidence: 0.99,
            reasonFa: 'حاوی کلمه پسورد',
            method: 'local_llm',
            modelUsed: 'mock',
            latencyMs: 1,
          };
        }
        return {
          decision: 'SAFE',
          scope: 'GENERAL',
          matchedConcepts: [],
          confidence: 0.95,
          reasonFa: 'امن',
          method: 'local_llm',
          modelUsed: 'mock',
          latencyMs: 1,
        };
      });

      const res2 = await mock.classify({
        prompt: 'پسورد دیتابیس چیست؟',
        candidateConcepts: [],
      });
      expect(res2.decision).toBe('SENSITIVE');
      expect(res2.matchedConcepts).toEqual(['auth_credentials']);

      // Error throwing
      mock.setThrow(new Error('Simulated failure'));
      await expect(
        mock.classify({ prompt: 'fail test', candidateConcepts: [] }),
      ).rejects.toThrow('Simulated failure');
    });
  });

  describe('Classifier Evaluator with Evaluation Set', () => {
    it('evaluates accuracy, precision, recall, and F1 on eval set using a rule-informed mock', async () => {
      const mock = new MockSemanticClassifier();

      // Configure mock to simulate a well-tuned local classifier matching eval labels
      mock.setHandler((input) => {
        const p = input.prompt.toLowerCase();
        const isGeneral =
          p.includes('پایتون') ||
          p.includes('جاوااسکریپت') ||
          p.includes('نامتقارن') ||
          p.includes('عمومی') ||
          p.includes('rfc');

        if (isGeneral) {
          return {
            decision: 'SAFE',
            scope: 'GENERAL',
            matchedConcepts: [],
            confidence: 0.95,
            reasonFa: 'دانش عمومی یا نمونه منفی',
            method: 'local_llm',
            modelUsed: 'mock-classifier',
            latencyMs: 10,
          };
        }

        const candidateKeys = input.candidateConcepts.map(
          (c: any) => c.conceptKey ?? (c.concept && c.concept.conceptKey),
        );

        return {
          decision: 'SENSITIVE',
          scope: 'ORG_SPECIFIC',
          matchedConcepts: candidateKeys.slice(0, 1),
          confidence: 0.92,
          reasonFa: 'درخواست داده حساس سازمانی',
          method: 'local_llm',
          modelUsed: 'mock-classifier',
          latencyMs: 12,
        };
      });

      const metrics = await evaluateSemanticClassifier(mock, evalSetData as any);

      expect(metrics.totalQueries).toBe(10);
      expect(metrics.evaluatedQueries).toBe(10);
      expect(metrics.accuracy).toBe(1.0);
      expect(metrics.sensitivePrecision).toBe(1.0);
      expect(metrics.sensitiveRecall).toBe(1.0);
      expect(metrics.sensitiveF1).toBe(1.0);
      expect(metrics.safeAccuracy).toBe(1.0);
      expect(metrics.fallbackCount).toBe(0);
      expect(metrics.mismatches).toHaveLength(0);
    });
  });
});
