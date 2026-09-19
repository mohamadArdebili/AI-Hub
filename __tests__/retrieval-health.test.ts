import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PolicyConcept } from '@/lib/policy/concepts/types';
import { HybridRetriever } from '@/lib/policy/retrieval/hybrid-retriever';
import { MockEmbeddingProvider, buildConceptEmbeddingText, computeEmbeddingTextHash } from '@/lib/policy/retrieval/embeddings';
import { OllamaClient } from '@/lib/policy/local-llm/ollama-client';
import type { VectorStore } from '@/lib/policy/retrieval/vector-store';

const repository = vi.hoisted(() => ({ active: vi.fn() }));
vi.mock('@/lib/policy/concepts/repository', () => ({ getActiveConcepts: repository.active }));
const provider = new MockEmbeddingProvider('test', 2);
const store = { search: vi.fn(async () => []), upsertEmbedding: vi.fn(), deleteEmbedding: vi.fn(), rebuildIndex: vi.fn() } as unknown as VectorStore;
let concept: PolicyConcept;
beforeEach(() => {
  concept = { id: 'c', conceptKey: 'c', organizationId: 'o', documentId: 'd', name: 'Rule', descriptionFa: 'rule',
    sensitivity: 'CONFIDENTIAL', action: 'ROUTE_LOCAL', positiveExamples: [], negativeExamples: [], keywords: [], conditions: [],
    sourceQuote: 'rule', confidence: 1, reviewStatus: 'ACTIVE' };
  concept.embedding = { conceptId: 'c', model: 'test', dim: 2, vector: [1, 0],
    textHash: computeEmbeddingTextHash(buildConceptEmbeddingText(concept)) };
  repository.active.mockResolvedValue([concept]);
});

describe('runtime retrieval readiness', () => {
  it.each(['missing', 'stale', 'model', 'dimension', 'nonfinite', 'zero'])('refuses a %s index even if lexical matching would succeed', async kind => {
    if (kind === 'missing') concept.embedding = null;
    else if (kind === 'stale') concept.embedding!.textHash = 'old';
    else if (kind === 'model') concept.embedding!.model = 'other';
    else if (kind === 'dimension') concept.embedding!.dim = 3;
    else if (kind === 'nonfinite') concept.embedding!.vector = [NaN, 1];
    else concept.embedding!.vector = [0, 0];
    await expect(new HybridRetriever(provider, store).retrieve('rule', { organizationId: 'o' })).rejects.toThrow('POLICY_INDEX_MISSING_OR_STALE');
  });
  it('refuses a policy with no approved concepts', async () => {
    repository.active.mockResolvedValue([]);
    await expect(new HybridRetriever(provider, store).retrieve('hello', { organizationId: 'o' })).rejects.toThrow('NO_APPROVED_POLICY_CONCEPTS');
  });
  it('refuses to truncate classifier context before transport is invoked', async () => {
    const postJson = vi.fn();
    const client = new OllamaClient({ getJson: vi.fn(), postJson });
    await expect(client.generate('الف'.repeat(6000), { maxTokens: 512 })).rejects.toThrow('CLASSIFIER_CONTEXT_TOO_LARGE');
    expect(postJson).not.toHaveBeenCalled();
  });
});
