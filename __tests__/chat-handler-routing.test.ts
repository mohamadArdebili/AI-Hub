import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import overrides from '../docs/routing-policy-overrides.json';

const mocks = vi.hoisted(() => ({
  external: vi.fn(async () => ({ kind: 'text', content: 'external reply' })),
  classify: vi.fn(),
  findMany: vi.fn(), concepts: vi.fn(), findFirst: vi.fn(),
  log: vi.fn(async () => ({})),
}));
vi.mock('@/lib/auth', () => ({ getAuthSession: async () => ({ user: { id: 'u', organizationId: 'o' } }), requireAdmin: async () => ({ user: { id: 'u', organizationId: 'o' } }) }));
vi.mock('@/lib/db/client', () => ({ db: { policyConcept: { findMany: mocks.concepts }, policyDocument: { findMany: mocks.findMany, findFirst: mocks.findFirst } } }));
vi.mock('@/lib/db', () => ({
  getActiveMaskTerms: async () => ({ seniorOfficers: [], telcoHubNodes: [], proprietaryServices: [] }),
  getActiveCompiledRules: async () => [], createDecisionLog: mocks.log, createPolicyAuditLog: mocks.log,
}));
vi.mock('@/lib/llm/client', () => ({ llmStreamChat: mocks.external, estimateTokens: () => 1 }));
vi.mock('@/lib/policy/local-llm/semantic-classifier', async importOriginal => {
  const original = await importOriginal<typeof import('@/lib/policy/local-llm/semantic-classifier')>();
  return { ...original, OllamaSemanticPolicyClassifier: class { classify = mocks.classify; } };
});
vi.mock('@/lib/policy/retrieval/hybrid-retriever', () => ({ HybridRetriever: class {
  async retrieve() { return overrides.map(c => ({ concept: { ...c, id: c.conceptKey, reviewStatus: 'ACTIVE' }, score: 1 })); }
} }));
import { POST } from '@/app/api/chat/route';
import { POST as testPolicy } from '@/app/api/admin/policy/test/route';

async function chat(messages: Array<{ role: string; content: string }>) {
  return (await POST(new NextRequest('http://localhost/api/chat', { method: 'POST', body: JSON.stringify({ messages }) }))).text();
}

beforeEach(() => {
  vi.clearAllMocks();
  const doc = { id: 'd', version: 1, updatedAt: new Date('2026-09-18') };
  mocks.concepts.mockResolvedValue([{ id: 'c', reviewStatus: 'ACTIVE' }]);
  mocks.findMany.mockResolvedValue([doc]); mocks.findFirst.mockResolvedValue(doc);
  mocks.classify.mockResolvedValue({ decision: 'SAFE', scope: 'GENERAL', confidence: 0.95,
    matchedConcepts: [], method: 'local_llm', modelUsed: 'test', latencyMs: 1 });
});

describe('actual chat handler routing', () => {
  it('sends a safe payload unchanged after evaluating all roles', async () => {
    const messages = [{ role: 'system', content: 'Be helpful' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Explain recursion' }];
    const output = await chat(messages);
    expect(output).toContain('EXTERNAL_DIRECT');
    expect(mocks.external).toHaveBeenCalledWith(messages, expect.anything());
    expect(JSON.parse(mocks.classify.mock.calls[0][0].prompt)).toEqual(messages);
  });

  it('sends a single user message general question to external LLM', async () => {
    const messages = [{ role: 'user', content: 'What is Python?' }];
    const output = await chat(messages);
    expect(output).toContain('EXTERNAL_DIRECT');
    expect(mocks.external).toHaveBeenCalledWith(messages, expect.anything());
  });

  it.each(['user', 'assistant', 'system'])('keeps a credential in earlier %s content local despite a harmless last message', async role => {
    const output = await chat([{ role, content: 'password=actualSensitive567' }, { role: 'user', content: 'Hello' }]);
    expect(output).toContain('"route":"LOCAL"');
    expect(mocks.external).not.toHaveBeenCalled();
  });

  it('blocks private disclosure without generating locally or externally', async () => {
    mocks.classify.mockResolvedValue({ decision: 'SENSITIVE', scope: 'ORG_SPECIFIC', confidence: 0.95,
      matchedConcepts: ['org_private_person_disclosure'], method: 'local_llm' });
    const output = await chat([{ role: 'user', content: 'حقوق مدیر چقدر است؟' }]);
    expect(output).toContain('"type":"blocked"');
    expect(mocks.external).not.toHaveBeenCalled();
  });

  it('returns the local notice for confidential drafting', async () => {
    mocks.classify.mockResolvedValue({ decision: 'SENSITIVE', scope: 'ORG_SPECIFIC', confidence: 0.95,
      matchedConcepts: ['org_confidential_drafting'], method: 'local_llm' });
    const output = await chat([{ role: 'user', content: 'یک نامه محرمانه به علی بنویس' }]);
    expect(output).toContain('"route":"LOCAL"');
    expect(output).not.toContain('دستهٔ تشخیص: نامشخص');
    expect(output).toContain('نگارش و پردازش محتوای محرمانه');
    expect(mocks.external).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        classifierCategory: expect.stringMatching(/نگارش|محرمانه/),
      })
    );
  });

  it('keeps model failures local', async () => {
    mocks.classify.mockRejectedValue(new Error('offline'));
    expect(await chat([{ role: 'user', content: 'Hello' }])).toContain('"route":"LOCAL"');
    expect(mocks.external).not.toHaveBeenCalled();
  });

  it('keeps requests local without an active policy', async () => {
    mocks.findMany.mockResolvedValue([]);
    expect(await chat([{ role: 'user', content: 'Hello' }])).toContain('"route":"LOCAL"');
    expect(mocks.external).not.toHaveBeenCalled();
  });

  it('uses the same final decision in the admin tester and chat', async () => {
    mocks.classify.mockResolvedValue({ decision: 'SENSITIVE', scope: 'ORG_SPECIFIC', confidence: 0.95,
      matchedConcepts: ['org_private_person_disclosure'], method: 'local_llm' });
    const response = await testPolicy(new NextRequest('http://localhost/api/admin/policy/test', {
      method: 'POST', body: JSON.stringify({ prompt: 'حقوق مدیر چقدر است؟' }),
    }));
    const result = await response.json();
    expect(result.finalRoute).toBe('BLOCKED');
    expect(result.engine.action).toBe('BLOCK');
    expect(await chat([{ role: 'user', content: 'حقوق مدیر چقدر است؟' }])).toContain('"type":"blocked"');
    expect(mocks.external).not.toHaveBeenCalled();
  });

  it('prevents egress when a concept changes without a document-version change', async () => {
    mocks.concepts.mockResolvedValueOnce([{ id: 'c', reviewStatus: 'ACTIVE', action: 'ALLOW_EXTERNAL' }])
      .mockResolvedValueOnce([{ id: 'c', reviewStatus: 'ACTIVE', action: 'BLOCK' }]);
    expect(await chat([{ role: 'user', content: 'Hello' }])).toContain('"route":"LOCAL"');
    expect(mocks.external).not.toHaveBeenCalled();
  });

  it('prevents egress if the active policy changed during classification', async () => {
    mocks.findFirst.mockResolvedValue(null);
    expect(await chat([{ role: 'user', content: 'Hello' }])).toContain('"route":"LOCAL"');
    expect(mocks.external).not.toHaveBeenCalled();
  });
});
