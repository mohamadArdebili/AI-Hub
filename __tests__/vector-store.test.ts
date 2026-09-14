// Integration tests for In-Process Cosine Vector Store
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 3, §3.2, spec §16, §17)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import {
  cosineSimilarity,
  PrismaVectorStore,
} from '@/lib/policy/retrieval/vector-store';
import { MockEmbeddingProvider } from '@/lib/policy/retrieval/embeddings';
import { createConcept, approveConcept } from '@/lib/policy/concepts/repository';

describe('Cosine Similarity Mathematics', () => {
  it('returns 1.0 for identical non-zero vectors', () => {
    const v = [0.6, 0.8];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0.0 for orthogonal vectors', () => {
    const v1 = [1, 0];
    const v2 = [0, 1];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0.0, 5);
  });

  it('returns -1.0 for opposite vectors', () => {
    const v1 = [1, 0];
    const v2 = [-1, 0];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(-1.0, 5);
  });

  it('handles empty or mismatched vectors safely', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
  });
});

describe('PrismaVectorStore Operations', () => {
  const TEST_ORG_ID = 'test-org-retrieval-' + Date.now();
  const TEST_USER_ID = 'test-user-retrieval-' + Date.now();
  const TEST_DOC_ID = 'test-doc-retrieval-' + Date.now();

  let concept1Id: string;
  let concept2Id: string;

  beforeAll(async () => {
    await db.organization.create({
      data: { id: TEST_ORG_ID, name: 'سازمان تست بازیابی' },
    });

    await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: `retrieval-tester-${Date.now()}@example.com`,
        passwordHash: 'dummy',
        organizationId: TEST_ORG_ID,
      },
    });

    await db.policyDocument.create({
      data: {
        id: TEST_DOC_ID,
        organizationId: TEST_ORG_ID,
        uploadedById: TEST_USER_ID,
        filename: 'retrieval-test.pdf',
        size: 512,
        storagePath: '/tmp/retrieval.pdf',
        status: 'READY',
        lifecycle: 'ACTIVE',
        isActive: true,
      },
    });

    // Create 2 concepts: one active, one in review
    const c1 = await createConcept({
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      conceptKey: 'active_db_creds',
      name: 'Database Credentials',
      descriptionFa: 'رمز عبور و کلیدهای دیتابیس',
      sensitivity: 'HIGHLY_CONFIDENTIAL',
      action: 'BLOCK',
      sourceQuote: 'رمز عبور دیتابیس نباید افشا شود.',
      reviewStatus: 'ACTIVE', // Active
    });
    concept1Id = c1.id;

    const c2 = await createConcept({
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      conceptKey: 'review_salary_info',
      name: 'Salary Info',
      descriptionFa: 'اطلاعات حقوق و فیش',
      sensitivity: 'CONFIDENTIAL',
      action: 'ROUTE_LOCAL',
      sourceQuote: 'اطلاعات حقوق کارکنان محرمانه است.',
      reviewStatus: 'REVIEW', // Still in review!
    });
    concept2Id = c2.id;
  });

  afterAll(async () => {
    try {
      await db.organization.delete({ where: { id: TEST_ORG_ID } });
    } catch {}
  });

  it('indexes active concepts and strictly ignores unapproved concepts (spec §16)', async () => {
    const vectorStore = new PrismaVectorStore();
    const provider = new MockEmbeddingProvider('test-embed', 16);

    // Rebuild index for the document
    const report = await vectorStore.rebuildIndex(TEST_ORG_ID, TEST_DOC_ID, provider);

    // Only 1 concept is ACTIVE, so only 1 should be indexed
    expect(report.indexed).toBe(1);

    // Perform vector search
    const queryVec = await provider.embed('رمز دیتابیس چیست؟');
    const results = await vectorStore.search(queryVec, {
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      topK: 5,
    });

    expect(results).toHaveLength(1);
    expect(results[0].concept.id).toBe(concept1Id);
    expect(results[0].concept.conceptKey).toBe('active_db_creds');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('includes newly approved concepts after re-indexing', async () => {
    const vectorStore = new PrismaVectorStore();
    const provider = new MockEmbeddingProvider('test-embed', 16);

    // Approve concept 2
    await approveConcept(concept2Id, TEST_ORG_ID);

    // Rebuild index
    const report = await vectorStore.rebuildIndex(TEST_ORG_ID, TEST_DOC_ID, provider);
    expect(report.indexed).toBe(2);

    // Search
    const queryVec = await provider.embed('حقوق کارکنان');
    const results = await vectorStore.search(queryVec, {
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      topK: 5,
    });

    expect(results.length).toBeGreaterThanOrEqual(2);
  });
});
