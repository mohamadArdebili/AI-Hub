// Comprehensive tests for Admin Editable Semantic Concepts
// (AGENT_TASK_ADMIN_EDITABLE_SEMANTIC_CONCEPTS.md §18, §5, §6, §7, §10, §11, §14, §17)

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import {
  createConcept,
  getConceptById,
  deleteConcept,
  approveConcept,
} from '@/lib/policy/concepts/repository';
import { PrismaVectorStore } from '@/lib/policy/retrieval/vector-store';
import { HybridRetriever } from '@/lib/policy/retrieval/hybrid-retriever';
import {
  buildConceptEmbeddingText,
  computeEmbeddingTextHash,
  MockEmbeddingProvider,
} from '@/lib/policy/retrieval/embeddings';

// Mock server-only
vi.mock('server-only', () => ({}));

// Controllable embedding mock
export const mockEmbeddingControl = {
  forceFailure: false,
};

vi.mock('@/lib/policy/retrieval/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/policy/retrieval/embeddings')>();
  class ControlledEmbeddingProvider extends actual.MockEmbeddingProvider {
    constructor() {
      super('mock-bge-m3', 32);
    }
    async embed(text: string): Promise<number[]> {
      if (mockEmbeddingControl.forceFailure) {
        throw new Error('Ollama service connection failed (simulated fail-closed)');
      }
      return super.embed(text);
    }
    async embedBatch(texts: string[]): Promise<number[][]> {
      if (mockEmbeddingControl.forceFailure) {
        throw new Error('Ollama service connection failed (simulated fail-closed)');
      }
      return super.embedBatch(texts);
    }
  }

  return {
    ...actual,
    OllamaEmbeddingProvider: ControlledEmbeddingProvider,
  };
});

const mockSessionState = {
  id: 'test-admin-edit-a',
  email: 'admin-edit-a@example.com',
  name: 'Admin Edit A',
  role: 'ADMIN',
  organizationId: 'test-org-edit-a',
};

vi.mock('@/lib/auth', () => ({
  requireAdmin: vi.fn(async () => {
    if (mockSessionState.role !== 'ADMIN') {
      throw new Response(JSON.stringify({ error: 'فقط مدیران به این بخش دسترسی دارند' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return {
      user: {
        id: mockSessionState.id,
        email: mockSessionState.email,
        name: mockSessionState.name,
        role: mockSessionState.role,
        organizationId: mockSessionState.organizationId,
      },
    };
  }),
}));

import { GET, PATCH, DELETE } from '@/app/api/admin/concepts/[id]/route';

describe('Admin Editable Semantic Concepts (§18 Requirements)', () => {
  const TEST_ORG_A = 'test-org-edit-a-' + Date.now();
  const TEST_ORG_B = 'test-org-edit-b-' + Date.now();
  const TEST_ADMIN_A = 'test-admin-edit-a-' + Date.now();
  const TEST_ADMIN_B = 'test-admin-edit-b-' + Date.now();
  const TEST_DOC_ACTIVE = 'test-doc-edit-act-' + Date.now();
  const TEST_DOC_INACTIVE = 'test-doc-edit-inact-' + Date.now();

  beforeAll(async () => {
    // 1. Create Org A and Org B
    await db.organization.create({
      data: { id: TEST_ORG_A, name: 'سازمان تست ویرایش مفاهیم A' },
    });
    await db.organization.create({
      data: { id: TEST_ORG_B, name: 'سازمان تست ویرایش مفاهیم B' },
    });

    // 2. Create Admin users
    await db.user.create({
      data: {
        id: TEST_ADMIN_A,
        email: `admin-edit-a-${Date.now()}@example.com`,
        passwordHash: 'dummy',
        role: 'ADMIN',
        organizationId: TEST_ORG_A,
      },
    });
    await db.user.create({
      data: {
        id: TEST_ADMIN_B,
        email: `admin-edit-b-${Date.now()}@example.com`,
        passwordHash: 'dummy',
        role: 'ADMIN',
        organizationId: TEST_ORG_B,
      },
    });

    // 3. Create Active Policy Document in Org A
    await db.policyDocument.create({
      data: {
        id: TEST_DOC_ACTIVE,
        organizationId: TEST_ORG_A,
        uploadedById: TEST_ADMIN_A,
        filename: 'active-policy.pdf',
        size: 1024,
        storagePath: '/tmp/act.pdf',
        status: 'READY',
        lifecycle: 'ACTIVE',
        isActive: true,
      },
    });

    // 4. Create Inactive (Old) Policy Document in Org A
    await db.policyDocument.create({
      data: {
        id: TEST_DOC_INACTIVE,
        organizationId: TEST_ORG_A,
        uploadedById: TEST_ADMIN_A,
        filename: 'inactive-old-policy.pdf',
        size: 1024,
        storagePath: '/tmp/inact.pdf',
        status: 'READY',
        lifecycle: 'ARCHIVED',
        isActive: false,
      },
    });
  });

  afterAll(async () => {
    try {
      await db.organization.delete({ where: { id: TEST_ORG_A } });
    } catch {}
    try {
      await db.organization.delete({ where: { id: TEST_ORG_B } });
    } catch {}
  });

  // ── Test 1: Edit Description ──────────────────────────────────────────────
  it('1. Edit description: updates DB record successfully', async () => {
    mockSessionState.id = TEST_ADMIN_A;
    mockSessionState.organizationId = TEST_ORG_A;
    mockSessionState.role = 'ADMIN';

    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      conceptKey: 'edit_desc_test',
      name: 'Initial Name',
      nameFa: 'نام اولیه',
      descriptionFa: 'شرح اولیه قبل از ویرایش مدیر',
      sensitivity: 'INTERNAL',
      action: 'ROUTE_LOCAL',
      sourceQuote: 'نقل‌قول مبنا برای تست ویرایش',
      reviewStatus: 'REVIEW',
    });

    const newDescription = 'شرح اصلاح‌شده توسط ادمین در تست ویرایش';
    const req = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descriptionFa: newDescription,
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: concept.id }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.concept.descriptionFa).toBe(newDescription);

    // Verify directly in DB
    const inDb = await getConceptById(concept.id, TEST_ORG_A);
    expect(inDb).not.toBeNull();
    expect(inDb?.descriptionFa).toBe(newDescription);
  });

  // ── Test 2: Embedding Regeneration ────────────────────────────────────────
  it('2. Embedding regeneration: regenerates embedding with updated textHash when ACTIVE concept is edited', async () => {
    mockSessionState.id = TEST_ADMIN_A;
    mockSessionState.organizationId = TEST_ORG_A;

    // Create and approve an active concept
    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      conceptKey: 'embed_regen_test',
      name: 'Embedding Regen Concept',
      descriptionFa: 'شرح اولیه برای تست بازتولید امبدینگ',
      sensitivity: 'CONFIDENTIAL',
      action: 'ROUTE_LOCAL',
      sourceQuote: 'نقل قول امبدینگ',
      reviewStatus: 'ACTIVE',
    });

    const vectorStore = new PrismaVectorStore();
    const provider = new MockEmbeddingProvider('mock-bge-m3', 32);
    await vectorStore.regenerateConceptEmbedding(concept.id, TEST_ORG_A, provider);

    // Read initial embedding
    const initialEmbed = await db.policyConceptEmbedding.findUnique({
      where: { conceptId: concept.id },
    });
    expect(initialEmbed).not.toBeNull();
    const initialHash = initialEmbed?.textHash;

    // Admin edits the description via API
    const updatedDesc = 'شرح کاملاً جدید که باید متن و بردار امبدینگ را تغییر دهد';
    const req = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descriptionFa: updatedDesc,
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: concept.id }) });
    expect(res.status).toBe(200);

    // Read updated embedding
    const updatedEmbed = await db.policyConceptEmbedding.findUnique({
      where: { conceptId: concept.id },
    });
    expect(updatedEmbed).not.toBeNull();
    expect(updatedEmbed?.textHash).not.toBe(initialHash);

    // Verify that the new textHash matches the hash of buildConceptEmbeddingText
    const updatedConcept = await getConceptById(concept.id, TEST_ORG_A);
    const expectedHash = computeEmbeddingTextHash(buildConceptEmbeddingText(updatedConcept!));
    expect(updatedEmbed?.textHash).toBe(expectedHash);
  });

  // ── Test 3: Updated Retrieval ─────────────────────────────────────────────
  it('3. Updated retrieval: retrieval strictly reflects edited semantic content', async () => {
    mockSessionState.id = TEST_ADMIN_A;
    mockSessionState.organizationId = TEST_ORG_A;

    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      conceptKey: 'retrieval_update_test',
      name: 'Retrieval Update Concept',
      descriptionFa: 'اطلاعات مربوط به سرورهای لینوکسی و زیرساخت میزبانی',
      positiveExamples: ['پیکربندی سرور لینوکس'],
      sensitivity: 'CONFIDENTIAL',
      action: 'ROUTE_LOCAL',
      sourceQuote: 'اطلاعات سرورها محرمانه است.',
      reviewStatus: 'ACTIVE',
    });

    const vectorStore = new PrismaVectorStore();
    const provider = new MockEmbeddingProvider('mock-bge-m3', 32);
    await vectorStore.regenerateConceptEmbedding(concept.id, TEST_ORG_A, provider);

    const retriever = new HybridRetriever(provider, vectorStore);

    // Query for something completely different (e.g. حقوق و فیش پرسنلی) -> low score
    const initialResults = await retriever.retrieve('فیش حقوقی و دریافتی کارمندان', {
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      topK: 5,
    });
    const matchBefore = initialResults.find((r) => r.concept.id === concept.id);

    // Now Admin edits the concept to be about salaries
    const editReq = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descriptionFa: 'اطلاعات فیش حقوقی، مزایا و دریافتی کلیه کارمندان سازمان',
        positiveExamples: ['فیش حقوقی من چقدر است؟', 'دریافتی خالص ماهانه'],
      }),
    });
    const editRes = await PATCH(editReq, { params: Promise.resolve({ id: concept.id }) });
    expect(editRes.status).toBe(200);

    // Re-query: retrieval must now hit the edited concept with high rank/score!
    const updatedResults = await retriever.retrieve('فیش حقوقی و دریافتی کارمندان', {
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      topK: 5,
    });

    expect(updatedResults.length).toBeGreaterThan(0);
    const topHit = updatedResults[0];
    expect(topHit.concept.id).toBe(concept.id);
    expect(topHit.concept.descriptionFa).toContain('فیش حقوقی');
  });

  // ── Test 4 & 5: Positive & Negative Examples ──────────────────────────────
  it('4 & 5. Positive & Negative examples: add/edit/delete and negative examples excluded from vector embedding text', async () => {
    mockSessionState.id = TEST_ADMIN_A;
    mockSessionState.organizationId = TEST_ORG_A;

    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      conceptKey: 'examples_test',
      name: 'Examples Test',
      descriptionFa: 'تست نمونه‌های مثبت و منفی',
      sensitivity: 'INTERNAL',
      action: 'ROUTE_LOCAL',
      positiveExamples: ['نمونه مثبت اولیه ۱'],
      negativeExamples: ['نمونه منفی اولیه ۱'],
      sourceQuote: 'نقل قول برای نمونه‌ها',
      reviewStatus: 'ACTIVE',
    });

    // Edit examples
    const updatedPos = ['نمونه مثبت جدید الف', 'نمونه مثبت جدید ب'];
    const updatedNeg = ['نمونه منفی جدید ج (اطلاعات عمومی پورتال)'];

    const req = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        positiveExamples: updatedPos,
        negativeExamples: updatedNeg,
      }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: concept.id }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.concept.positiveExamples).toEqual(updatedPos);
    expect(json.concept.negativeExamples).toEqual(updatedNeg);

    // Verify DB relations
    const inDb = await getConceptById(concept.id, TEST_ORG_A);
    expect(inDb?.positiveExamples).toEqual(updatedPos);
    expect(inDb?.negativeExamples).toEqual(updatedNeg);

    // SPEC §0.1 #10 & AGENT_TASK §3: Negative examples must NEVER be part of primary embedding text!
    const embeddingText = buildConceptEmbeddingText(inDb!);
    expect(embeddingText).toContain('نمونه مثبت جدید الف');
    expect(embeddingText).toContain('نمونه مثبت جدید ب');
    expect(embeddingText).not.toContain('نمونه منفی جدید ج (اطلاعات عمومی پورتال)');
  });

  // ── Test 6: Delete Concept ────────────────────────────────────────────────
  it('6. Delete: permanently removes concept and cascades its embedding and examples', async () => {
    mockSessionState.id = TEST_ADMIN_A;
    mockSessionState.organizationId = TEST_ORG_A;

    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      conceptKey: 'to_delete_test',
      name: 'To Delete',
      descriptionFa: 'مفهوم برای حذف کامل',
      sensitivity: 'INTERNAL',
      action: 'ALLOW_EXTERNAL',
      positiveExamples: ['نمونه مثبت برای حذف'],
      negativeExamples: ['نمونه منفی برای حذف'],
      sourceQuote: 'نقل قول حذف',
      reviewStatus: 'ACTIVE',
    });

    const vectorStore = new PrismaVectorStore();
    const provider = new MockEmbeddingProvider('mock-bge-m3', 32);
    await vectorStore.regenerateConceptEmbedding(concept.id, TEST_ORG_A, provider);

    // Confirm existence
    expect(await getConceptById(concept.id, TEST_ORG_A)).not.toBeNull();
    const embedBefore = await db.policyConceptEmbedding.findUnique({
      where: { conceptId: concept.id },
    });
    expect(embedBefore).not.toBeNull();

    // Call DELETE API
    const req = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: concept.id }) });
    expect(res.status).toBe(200);

    // Verify concept is removed
    expect(await getConceptById(concept.id, TEST_ORG_A)).toBeNull();

    // Verify embedding is removed
    const embedAfter = await db.policyConceptEmbedding.findUnique({
      where: { conceptId: concept.id },
    });
    expect(embedAfter).toBeNull();

    // Verify examples are removed
    const examplesAfter = await db.policyConceptExample.findMany({
      where: { conceptId: concept.id },
    });
    expect(examplesAfter).toHaveLength(0);
  });

  // ── Test 7: Organization Isolation ────────────────────────────────────────
  it('7. Organization isolation: Admin of Org B cannot GET, PATCH, or DELETE Org A concept', async () => {
    // Concept belongs to Org A
    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      conceptKey: 'tenant_isolation_concept',
      name: 'Org A Secret Concept',
      descriptionFa: 'مفهوم امنیتی محرمانه متعلق به سازمان A',
      sensitivity: 'HIGHLY_CONFIDENTIAL',
      action: 'BLOCK',
      sourceQuote: 'نقل قول محرمانه سازمان A',
      reviewStatus: 'ACTIVE',
    });

    // Switch session to Org B Admin
    mockSessionState.id = TEST_ADMIN_B;
    mockSessionState.organizationId = TEST_ORG_B;
    mockSessionState.role = 'ADMIN';

    // 1. GET attempt by Org B
    const getReq = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'GET',
    });
    const getRes = await GET(getReq, { params: Promise.resolve({ id: concept.id }) });
    expect(getRes.status).toBe(404);

    // 2. PATCH attempt by Org B
    const patchReq = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Hacked by Org B',
      }),
    });
    const patchRes = await PATCH(patchReq, { params: Promise.resolve({ id: concept.id }) });
    expect(patchRes.status).toBe(404);

    // 3. DELETE attempt by Org B
    const delReq = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'DELETE',
    });
    const delRes = await DELETE(delReq, { params: Promise.resolve({ id: concept.id }) });
    expect(delRes.status).toBe(404);

    // Verify Org A concept remains untouched
    const intact = await getConceptById(concept.id, TEST_ORG_A);
    expect(intact).not.toBeNull();
    expect(intact?.name).toBe('Org A Secret Concept');
  });

  // ── Test 8: Invalid Enum / Server-Side Validation ─────────────────────────
  it('8. Invalid enum & empty fields: fails server-side validation with 400', async () => {
    mockSessionState.id = TEST_ADMIN_A;
    mockSessionState.organizationId = TEST_ORG_A;

    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      conceptKey: 'validation_test',
      name: 'Valid Name',
      descriptionFa: 'شرح معتبر',
      sensitivity: 'INTERNAL',
      action: 'ROUTE_LOCAL',
      sourceQuote: 'نقل قول معتبر',
      reviewStatus: 'REVIEW',
    });

    // Invalid sensitivity enum
    const req1 = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sensitivity: 'SUPER_CONFIDENTIAL', // Invalid!
      }),
    });
    const res1 = await PATCH(req1, { params: Promise.resolve({ id: concept.id }) });
    expect(res1.status).toBe(400);

    // Invalid action enum
    const req2 = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'DO_NOTHING', // Invalid!
      }),
    });
    const res2 = await PATCH(req2, { params: Promise.resolve({ id: concept.id }) });
    expect(res2.status).toBe(400);

    // Empty name
    const req3 = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '   ', // Empty string
      }),
    });
    const res3 = await PATCH(req3, { params: Promise.resolve({ id: concept.id }) });
    expect(res3.status).toBe(400);
  });

  // ── Test 9: Embedding Failure / Fail Closed ────────────────────────────────
  it('9. Embedding failure: fails closed and does not allow stale embedding to masquerade as current', async () => {
    mockSessionState.id = TEST_ADMIN_A;
    mockSessionState.organizationId = TEST_ORG_A;

    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      conceptKey: 'embed_fail_test',
      name: 'Fail Closed Concept',
      descriptionFa: 'شرح اصلی قبل از قطعی امبدینگ',
      sensitivity: 'CONFIDENTIAL',
      action: 'ROUTE_LOCAL',
      sourceQuote: 'نقل قول تست قطعی',
      reviewStatus: 'ACTIVE',
    });

    const vectorStore = new PrismaVectorStore();
    const provider = new MockEmbeddingProvider('mock-bge-m3', 32);
    await vectorStore.regenerateConceptEmbedding(concept.id, TEST_ORG_A, provider);

    // Verify embedding exists initially
    expect(
      await db.policyConceptEmbedding.findUnique({ where: { conceptId: concept.id } }),
    ).not.toBeNull();

    // Trigger simulated embedding service failure
    mockEmbeddingControl.forceFailure = true;

    try {
      const editReq = new NextRequest(`http://localhost/api/admin/concepts/${concept.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          descriptionFa: 'شرح جدید در وضعیت خرابی سرویس امبدینگ',
        }),
      });

      const res = await PATCH(editReq, { params: Promise.resolve({ id: concept.id }) });
      // Must fail with error response (500)
      expect(res.status).toBe(500);

      // Invariant: The old stale embedding must have been deleted / invalidated!
      const embedAfterFailure = await db.policyConceptEmbedding.findUnique({
        where: { conceptId: concept.id },
      });
      expect(embedAfterFailure).toBeNull();

      // Retrieval search must NOT return this concept dense candidate
      const queryVec = await provider.embed('شرح اصلی قبل از قطعی');
      const searchHits = await vectorStore.search(queryVec, {
        organizationId: TEST_ORG_A,
        documentId: TEST_DOC_ACTIVE,
      });
      expect(searchHits.find((h) => h.concept.id === concept.id)).toBeUndefined();
    } finally {
      mockEmbeddingControl.forceFailure = false;
    }
  });

  // ── Test 10: ACTIVE Concept Stale Embedding Prevention in Retrieval ────────
  it('10. ACTIVE Concept edit: vector store search strictly skips concepts whose embedding textHash does not match current content', async () => {
    mockSessionState.id = TEST_ADMIN_A;
    mockSessionState.organizationId = TEST_ORG_A;

    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
      conceptKey: 'drift_detection_test',
      name: 'Drift Test',
      descriptionFa: 'شرح نسخه اول برای تست عدم استفاده از امبدینگ منسوخ',
      sensitivity: 'CONFIDENTIAL',
      action: 'ROUTE_LOCAL',
      sourceQuote: 'نقل قول تطابق هش',
      reviewStatus: 'ACTIVE',
    });

    const vectorStore = new PrismaVectorStore();
    const provider = new MockEmbeddingProvider('mock-bge-m3', 32);
    await vectorStore.regenerateConceptEmbedding(concept.id, TEST_ORG_A, provider);

    // Verify search finds it before edit
    const queryVec = await provider.embed('شرح نسخه اول');
    const hitsBefore = await vectorStore.search(queryVec, {
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
    });
    expect(hitsBefore.find((h) => h.concept.id === concept.id)).toBeDefined();

    // Directly mutate descriptionFa in DB to simulate a drift without regenerating embedding
    await db.policyConcept.update({
      where: { id: concept.id },
      data: { descriptionFa: 'شرح نسخه دوم تغییر یافته مستقیماً در دیتابیس بدون به‌روزرسانی بردار' },
    });

    // Vector search must detect textHash drift and refuse to return stale candidate!
    const hitsAfter = await vectorStore.search(queryVec, {
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_ACTIVE,
    });
    expect(hitsAfter.find((h) => h.concept.id === concept.id)).toBeUndefined();
  });

  // ── Test 11: Active Policy Scoping ────────────────────────────────────────
  it('11. Active policy scoping: concepts belonging to inactive documents are strictly excluded from runtime retrieval', async () => {
    mockSessionState.id = TEST_ADMIN_A;
    mockSessionState.organizationId = TEST_ORG_A;

    // Create an active concept on an INACTIVE document (e.g. from an old archived policy upload)
    const oldConcept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_INACTIVE,
      conceptKey: 'old_archived_policy_concept',
      name: 'Old Archived Concept',
      descriptionFa: 'این مفهوم متعلق به نسخه سند قبلی و غیرفعال است',
      sensitivity: 'CONFIDENTIAL',
      action: 'BLOCK',
      sourceQuote: 'نقل قول قدیمی',
      reviewStatus: 'ACTIVE',
    });

    const vectorStore = new PrismaVectorStore();
    const provider = new MockEmbeddingProvider('mock-bge-m3', 32);
    // Index the old concept
    const text = buildConceptEmbeddingText(oldConcept);
    const textHash = computeEmbeddingTextHash(text);
    const vec = await provider.embed(text);
    await vectorStore.upsertEmbedding(oldConcept.id, vec, provider.getModel(), textHash);

    // Perform hybrid retrieval with no documentId specified (runtime default mode)
    const retriever = new HybridRetriever(provider, vectorStore);
    const results = await retriever.retrieve('این مفهوم متعلق به نسخه سند قبلی است', {
      organizationId: TEST_ORG_A,
      // documentId omitted -> must scope to active document only!
    });

    // Old inactive concept must NOT contaminate runtime results!
    expect(results.find((r) => r.concept.id === oldConcept.id)).toBeUndefined();
  });
});
