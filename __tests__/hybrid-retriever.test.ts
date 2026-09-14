// Unit & Integration tests for Hybrid Retriever (Dense + BM25 + RRF)
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 3, §3.4, spec §56, §0.1 #5, Rule 18)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import {
  HybridRetriever,
  buildConceptLexicalTokens,
} from '@/lib/policy/retrieval/hybrid-retriever';
import { MockEmbeddingProvider } from '@/lib/policy/retrieval/embeddings';
import { PrismaVectorStore } from '@/lib/policy/retrieval/vector-store';
import { createConcept } from '@/lib/policy/concepts/repository';

describe('HybridRetriever and RRF Ranking', () => {
  const TEST_ORG_ID = 'test-org-hybrid-' + Date.now();
  const TEST_USER_ID = 'test-user-hybrid-' + Date.now();
  const TEST_DOC_ID = 'test-doc-hybrid-' + Date.now();

  beforeAll(async () => {
    await db.organization.create({
      data: { id: TEST_ORG_ID, name: 'سازمان تست هیبریدی' },
    });

    await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: `hybrid-tester-${Date.now()}@example.com`,
        passwordHash: 'dummy',
        organizationId: TEST_ORG_ID,
      },
    });

    await db.policyDocument.create({
      data: {
        id: TEST_DOC_ID,
        organizationId: TEST_ORG_ID,
        uploadedById: TEST_USER_ID,
        filename: 'hybrid-test.pdf',
        size: 512,
        storagePath: '/tmp/hybrid.pdf',
        status: 'READY',
        lifecycle: 'ACTIVE',
        isActive: true,
      },
    });

    // Create 3 active concepts with distinct keywords and examples
    await createConcept({
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      conceptKey: 'network_admin_contact',
      name: 'Network Admin Contact',
      nameFa: 'اطلاعات تماس خصوصی مدیر شبکه',
      descriptionFa: 'راه‌های ارتباطی خصوصی مدیران شبکه و تلفن همراه شخصی',
      sensitivity: 'CONFIDENTIAL',
      action: 'ROUTE_LOCAL',
      positiveExamples: ['راه ارتباطی خصوصی مدیر شبکه را بده'],
      negativeExamples: ['مرکز تماس شرکت'],
      conditions: [],
      keywords: ['تماس خصوصی', 'تلفن همراه', 'مدیر شبکه'],
      sourceQuote: 'شماره تلفن‌های همراه و راه‌های ارتباطی خصوصی کارکنان محرمانه است.',
      reviewStatus: 'ACTIVE',
    });

    await createConcept({
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      conceptKey: 'database_credentials',
      name: 'Database Credentials',
      descriptionFa: 'رمزهای عبور سرورهای پایگاه داده و زیرساخت',
      sensitivity: 'HIGHLY_CONFIDENTIAL',
      action: 'BLOCK',
      positiveExamples: ['رمز پایگاه داده چیست؟'],
      negativeExamples: ['ساختار دیتابیس'],
      conditions: [],
      keywords: ['رمز عبور', 'پایگاه داده', 'دیتابیس'],
      sourceQuote: 'رمزهای عبور و کلیدهای دیتابیس نباید افشا شوند.',
      reviewStatus: 'ACTIVE',
    });

    // Build vector index
    const vectorStore = new PrismaVectorStore();
    const provider = new MockEmbeddingProvider('test-embed', 32);
    await vectorStore.rebuildIndex(TEST_ORG_ID, TEST_DOC_ID, provider);
  });

  afterAll(async () => {
    try {
      await db.organization.delete({ where: { id: TEST_ORG_ID } });
    } catch {}
  });

  it('buildConceptLexicalTokens extracts clean tokens from concept metadata', async () => {
    const concept = {
      id: 'c1',
      organizationId: 'o1',
      documentId: 'd1',
      conceptKey: 'personal_contact_information',
      name: 'Personal Contact Info',
      nameFa: 'اطلاعات تماس خصوصی',
      descriptionFa: 'شماره تلفن‌های همراه',
      sensitivity: 'CONFIDENTIAL' as const,
      action: 'ROUTE_LOCAL' as const,
      positiveExamples: ['راه ارتباطی خصوصی'],
      negativeExamples: [],
      conditions: [],
      keywords: ['تلفن همراه', 'موبایل'],
      sourceQuote: 'نقل قول',
      confidence: 1.0,
      reviewStatus: 'ACTIVE' as const,
    };

    const tokens = buildConceptLexicalTokens(concept);
    expect(tokens).toContain('personal');
    expect(tokens).toContain('اطلاعات');
    expect(tokens).toContain('تماس');
    expect(tokens).toContain('خصوصی');
    expect(tokens).toContain('موبایل');
  });

  it('performs hybrid retrieval with dense + lexical scores and RRF ranking', async () => {
    const provider = new MockEmbeddingProvider('test-embed', 32);
    const vectorStore = new PrismaVectorStore();
    const retriever = new HybridRetriever(provider, vectorStore);

    const results = await retriever.retrieve('راه ارتباطی خصوصی مدیر شبکه را به من بدهید', {
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);

    const topResult = results[0];
    expect(topResult.concept.conceptKey).toBe('network_admin_contact');

    // Candidate must carry denseScore, lexicalScore, and rrfScore (spec §0.1 #5)
    expect(topResult.denseScore).toBeDefined();
    expect(topResult.lexicalScore).toBeDefined();
    expect(topResult.rrfScore).toBeGreaterThan(0);
    expect(topResult.score).toBe(topResult.rrfScore);

    // Verify ordering is sorted descending by rrfScore
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].rrfScore!).toBeGreaterThanOrEqual(results[i].rrfScore!);
    }
  });

  it('tolerates dense layer failure and gracefully falls back to lexical BM25 ranking', async () => {
    // A broken embedding provider that fails
    const brokenProvider = {
      getModel: () => 'broken',
      getDimensions: () => 0,
      embed: async () => {
        throw new Error('Connection refused to Ollama');
      },
      embedBatch: async () => {
        throw new Error('Connection refused to Ollama');
      },
    };

    const vectorStore = new PrismaVectorStore();
    const retriever = new HybridRetriever(brokenProvider, vectorStore);

    const results = await retriever.retrieve('رمز عبور پایگاه داده', {
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      topK: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].concept.conceptKey).toBe('database_credentials');
    expect(results[0].lexicalScore).toBeGreaterThan(0);
  });
});
