import type { ExtractedConcept } from '@/lib/policy/concepts/validator';
import { describe, expect, it, vi } from 'vitest';
import { extractExplicitRule, isPolicyMetadata } from '@/lib/policy/ingestion/explicit-rule-extractor';
import { extractPdfPages } from '@/lib/policy/ingestion/pdf-extractor';
import { segmentDocument } from '@/lib/policy/ingestion/segmenter';
import { OllamaPolicyConceptExtractor } from '@/lib/policy/local-llm/concept-extractor';
import { runDetectionV2 } from '@/lib/policy/detection/detection-pipeline';
import { MockSemanticClassifier, parseSemanticClassifierResponse } from '@/lib/policy/local-llm/semantic-classifier';
import type { HybridRetriever } from '@/lib/policy/retrieval/hybrid-retriever';
import { assertExternalEgressAllowed } from '@/lib/policy/external-guard';
import { payloadHash } from '@/lib/policy/conversation';
import overrides from '../docs/routing-policy-overrides.json';
import type { PolicyConcept } from '@/lib/policy/concepts/types';

const concepts = overrides.map((c, i) => ({ ...c, id: String(i), organizationId: 'o', documentId: 'd',
  confidence: 1, reviewStatus: 'ACTIVE' })) as PolicyConcept[];
const retriever = { retrieve: async () => concepts.map(concept => ({ concept, score: 1 })) } as unknown as HybridRetriever;

function detect(prompt: string, classifier = new MockSemanticClassifier()) {
  return runDetectionV2({ prompt, organizationId: 'o', hybridRetriever: retriever, classifier });
}

describe('policy_3 routing regressions', () => {
  it('extracts only the three PDF clauses, retaining financial identity and exceptions', async () => {
    const units = segmentDocument(await extractPdfPages('__tests__/fixtures/policy_3.pdf', { repairPersian: true }));
    const extractor = new OllamaPolicyConceptExtractor();
    const results: ExtractedConcept[] = [];
    for (const unit of units.filter(u => u.unitType !== 'HEADING')) results.push(...(await extractor.extract(unit)).concepts);
    expect(results.map(c => c.conceptKey)).toEqual(['sec_001', 'pii_001', 'fin_001']);
    expect(results.every(c => c.action === 'ROUTE_LOCAL' && c.conditions.length > 0)).toBe(true);
    expect(results[2].nameFa).toContain('حساب');
    expect(results[2].conditions.join(' ')).toContain('شناسه رهگیری');
    expect(results[1].conditions.join(' ')).toContain('نام فرد به تنهایی');
    expect(results[0].conditions.join(' ')).toContain('PASSWORD');
    expect(results.every(c => units.some(u => u.text.includes(c.sourceQuote)))).toBe(true);
  });

  it('does not guess ambiguous actions or turn definitions into rules', () => {
    expect(isPolicyMetadata('LOCAL_ONLY:\nمحتوا فقط محلی است')).toBe(true);
    expect(extractExplicitRule('قاعده SEC-001 ـ اسرار\nLOCAL_ONLY یا BLOCKED')).toBeNull();
  });

  it.each(['رمز عبور من MySecret567 است', 'شماره همراه شخصی من ۰۹۱۲۳۴۵۶۷۸۹ است', 'password=actualSecret567', '-----BEGIN PRIVATE KEY-----', 'sk-123456789012345678901234'])('routes supplied credentials locally: %s', async prompt => {
    const result = await detect(prompt);
    expect(result.route).toBe('LOCAL');
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it.each(['password=<PASSWORD>', 'API_KEY', 'password=PASSWORD'])('does not treat a placeholder as a credential: %s', async prompt => {
    expect((await detect(prompt)).route).toBe('EXTERNAL_DIRECT');
  });

  it('blocks confirmed private disclosure but routes confidential drafting locally', async () => {
    for (const [key, route] of [['org_private_person_disclosure', 'BLOCKED'], ['org_confidential_drafting', 'LOCAL']]) {
      const classifier = new MockSemanticClassifier({ decision: 'SENSITIVE', scope: 'ORG_SPECIFIC', matchedConcepts: [key] });
      expect((await detect('متن آزمایشی', classifier)).route).toBe(route);
    }
  });

  it('cannot externally route without policy candidates', async () => {
    const result = await runDetectionV2({ prompt: 'hello', organizationId: 'o', classifier: new MockSemanticClassifier(),
      hybridRetriever: { retrieve: async () => [] } as unknown as HybridRetriever });
    expect(result.route).toBe('LOCAL');
    expect(result.pipelineHealth).toBe('DEGRADED');
  });

  it('bounds a stalled retriever by the total deadline', async () => {
    vi.useFakeTimers();
    try {
      const pending = runDetectionV2({ prompt: 'hello', organizationId: 'o', timeoutBudgetMs: 100,
        classifier: new MockSemanticClassifier(),
        hybridRetriever: { retrieve: () => new Promise(() => {}) } as unknown as HybridRetriever });
      await vi.advanceTimersByTimeAsync(101);
      expect((await pending).route).toBe('LOCAL');
    } finally { vi.useRealTimers(); }
  });

  it('rejects inflated classifier confidence', () => {
    expect(parseSemanticClassifierResponse(JSON.stringify({ decision: 'SAFE', scope: 'GENERAL', confidence: 98, matchedConcepts: [], reasonFa: 'test' }))).toBeNull();
  });

  it('binds external permission to the exact full outgoing payload', async () => {
    const result = await detect('hello');
    result.processing.egressPayloadHash = payloadHash('approved');
    expect(() => assertExternalEgressAllowed({ outcome: result, route: 'EXTERNAL_DIRECT', egressPayload: 'approved' })).not.toThrow();
    expect(() => assertExternalEgressAllowed({ outcome: result, route: 'EXTERNAL_DIRECT', egressPayload: 'changed' })).toThrow(/Payload changed/);
  });
});
