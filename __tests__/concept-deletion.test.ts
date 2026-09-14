// Comprehensive tests for Policy Concept permanent deletion
// (delete_button_for_rules.txt requirements 1-11)

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { db } from '@/lib/db/client';
import {
  createConcept,
  getConceptById,
  getActiveConcepts,
  deleteConcept,
  addConceptSource,
} from '@/lib/policy/concepts/repository';

// Mock server-only and auth
vi.mock('server-only', () => ({}));

const mockSessionState = {
  id: 'test-admin-a',
  email: 'admin-a@example.com',
  name: 'Admin A',
  role: 'ADMIN',
  organizationId: 'test-org-del-a',
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

import { DELETE } from '@/app/api/admin/concepts/[id]/route';

describe('Policy Concept Permanent Deletion', () => {
  const TEST_ORG_A = 'test-org-del-a-' + Date.now();
  const TEST_ORG_B = 'test-org-del-b-' + Date.now();
  const TEST_ADMIN_A_ID = 'test-admin-a-' + Date.now();
  const TEST_DOC_A_ID = 'test-doc-a-' + Date.now();

  beforeAll(async () => {
    // 1. Create Org A and Org B
    await db.organization.create({
      data: { id: TEST_ORG_A, name: 'سازمان تست حذف مفاهیم A' },
    });
    await db.organization.create({
      data: { id: TEST_ORG_B, name: 'سازمان تست حذف مفاهیم B' },
    });

    // 2. Create Admin user in Org A
    await db.user.create({
      data: {
        id: TEST_ADMIN_A_ID,
        email: `admin-del-${Date.now()}@example.com`,
        passwordHash: 'dummy',
        role: 'ADMIN',
        organizationId: TEST_ORG_A,
      },
    });

    // Configure mock session
    mockSessionState.id = TEST_ADMIN_A_ID;
    mockSessionState.organizationId = TEST_ORG_A;
    mockSessionState.role = 'ADMIN';

    // 3. Create Policy Document in Org A
    await db.policyDocument.create({
      data: {
        id: TEST_DOC_A_ID,
        organizationId: TEST_ORG_A,
        uploadedById: TEST_ADMIN_A_ID,
        filename: 'deletion-test-policy.pdf',
        size: 2048,
        storagePath: '/tmp/del-test.pdf',
        status: 'READY',
        lifecycle: 'ACTIVE',
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    try {
      await db.organization.delete({ where: { id: TEST_ORG_A } });
    } catch {
      // Ignore
    }
    try {
      await db.organization.delete({ where: { id: TEST_ORG_B } });
    } catch {
      // Ignore
    }
  });

  it('successfully deletes a concept and verifies it is removed', async () => {
    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_A_ID,
      conceptKey: 'del_test_standard',
      name: 'Standard Deletion Test',
      nameFa: 'تست حذف استاندارد',
      descriptionFa: 'توضیحات برای تست حذف',
      category: 'آزمایشی',
      sensitivity: 'INTERNAL',
      action: 'ROUTE_LOCAL',
      sourceQuote: 'این نقل قول برای تست است.',
      reviewStatus: 'REVIEW',
    });

    expect(concept.id).toBeDefined();

    // Verify concept exists
    const before = await getConceptById(concept.id, TEST_ORG_A);
    expect(before).not.toBeNull();

    // Delete concept
    await deleteConcept(concept.id, TEST_ORG_A);

    // Verify concept is removed
    const after = await getConceptById(concept.id, TEST_ORG_A);
    expect(after).toBeNull();
  });

  it('rejects deletion when concept belongs to another organization (unauthorized isolation)', async () => {
    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_A_ID,
      conceptKey: 'del_test_org_isolation',
      name: 'Org Isolation Concept',
      descriptionFa: 'تست ایزولاسیون بین سازمانی',
      sensitivity: 'CONFIDENTIAL',
      action: 'BLOCK',
      sourceQuote: 'نقل قول امنیتی مهم',
      reviewStatus: 'REVIEW',
    });

    // Attempt deletion from TEST_ORG_B
    await expect(deleteConcept(concept.id, TEST_ORG_B)).rejects.toThrow(
      `PolicyConcept with id "${concept.id}" not found in organization "${TEST_ORG_B}"`,
    );

    // Verify concept still exists in TEST_ORG_A
    const stillExists = await getConceptById(concept.id, TEST_ORG_A);
    expect(stillExists).not.toBeNull();
    expect(stillExists?.id).toBe(concept.id);
  });

  it('rejects deletion when concept ID does not exist', async () => {
    const fakeId = 'nonexistent-concept-id-999';
    await expect(deleteConcept(fakeId, TEST_ORG_A)).rejects.toThrow(
      `PolicyConcept with id "${fakeId}" not found in organization "${TEST_ORG_A}"`,
    );
  });

  it('deletes an ACTIVE concept and removes it from active runtime concepts', async () => {
    const activeConcept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_A_ID,
      conceptKey: 'del_test_active_concept',
      name: 'Active Concept To Delete',
      descriptionFa: 'مفهوم فعال که باید حذف شود',
      sensitivity: 'HIGHLY_CONFIDENTIAL',
      action: 'BLOCK',
      sourceQuote: 'کلیدهای خصوصی زیرساخت',
      reviewStatus: 'ACTIVE',
    });

    // Create embedding for this active concept
    await db.policyConceptEmbedding.create({
      data: {
        conceptId: activeConcept.id,
        vector: JSON.stringify([0.1, 0.2, 0.3]),
        model: 'bge-m3',
        dim: 3,
        textHash: 'fake-hash-active',
      },
    });

    // Verify it appears in getActiveConcepts
    const activeListBefore = await getActiveConcepts(TEST_ORG_A);
    expect(activeListBefore.some((c) => c.id === activeConcept.id)).toBe(true);

    // Delete active concept
    await deleteConcept(activeConcept.id, TEST_ORG_A);

    // Verify it is no longer in getActiveConcepts
    const activeListAfter = await getActiveConcepts(TEST_ORG_A);
    expect(activeListAfter.some((c) => c.id === activeConcept.id)).toBe(false);

    // Verify getConceptById returns null
    const after = await getConceptById(activeConcept.id, TEST_ORG_A);
    expect(after).toBeNull();
  });

  it('cascades deletion to examples, provenance sources, and embedding vector', async () => {
    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_A_ID,
      conceptKey: 'del_test_cascading',
      name: 'Cascading Concept',
      descriptionFa: 'تست حذف آبشاری نمونه‌ها و بردارها',
      sensitivity: 'CONFIDENTIAL',
      action: 'ROUTE_LOCAL',
      positiveExamples: ['نمونه مثبت ۱', 'نمونه مثبت ۲'],
      negativeExamples: ['نمونه منفی ۱', 'نمونه منفی ۲'],
      sourceQuote: 'نقل قول اصلی منبع ۱',
      reviewStatus: 'ACTIVE',
    });

    // Add additional provenance source
    await addConceptSource(concept.id, {
      quote: 'نقل قول تکمیلی منبع ۲',
      page: 3,
    });

    // Add embedding vector
    await db.policyConceptEmbedding.create({
      data: {
        conceptId: concept.id,
        vector: JSON.stringify([0.5, 0.6, 0.7]),
        model: 'bge-m3',
        dim: 3,
        textHash: 'cascading-hash',
      },
    });

    // Verify all related records exist in DB
    const examplesBefore = await db.policyConceptExample.findMany({
      where: { conceptId: concept.id },
    });
    expect(examplesBefore.length).toBe(4);

    const sourcesBefore = await db.policyConceptSource.findMany({
      where: { conceptId: concept.id },
    });
    expect(sourcesBefore.length).toBe(2);

    const embeddingBefore = await db.policyConceptEmbedding.findUnique({
      where: { conceptId: concept.id },
    });
    expect(embeddingBefore).not.toBeNull();

    // Perform permanent deletion
    await deleteConcept(concept.id, TEST_ORG_A);

    // Verify concept is deleted
    const conceptInDb = await db.policyConcept.findUnique({
      where: { id: concept.id },
    });
    expect(conceptInDb).toBeNull();

    // Verify ALL cascaded relations are deleted
    const examplesAfter = await db.policyConceptExample.findMany({
      where: { conceptId: concept.id },
    });
    expect(examplesAfter).toHaveLength(0);

    const sourcesAfter = await db.policyConceptSource.findMany({
      where: { conceptId: concept.id },
    });
    expect(sourcesAfter).toHaveLength(0);

    const embeddingAfter = await db.policyConceptEmbedding.findUnique({
      where: { conceptId: concept.id },
    });
    expect(embeddingAfter).toBeNull();
  });

  it('DELETE /api/admin/concepts/[id] endpoint deletes concept, records audit log, and returns 200', async () => {
    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_A_ID,
      conceptKey: 'del_test_endpoint',
      name: 'API Endpoint Delete Test',
      descriptionFa: 'تست اندپوینت حذف',
      sensitivity: 'INTERNAL',
      action: 'ALLOW_EXTERNAL',
      sourceQuote: 'نقل قول اندپوینت',
      reviewStatus: 'REVIEW',
    });

    mockSessionState.organizationId = TEST_ORG_A;
    mockSessionState.id = TEST_ADMIN_A_ID;

    // Call DELETE API route
    const req = new NextRequest(`http://localhost:3000/api/admin/concepts/${concept.id}`, {
      method: 'DELETE',
    });

    const response = await DELETE(req, {
      params: Promise.resolve({ id: concept.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // Verify concept is gone from DB
    const deletedConcept = await getConceptById(concept.id, TEST_ORG_A);
    expect(deletedConcept).toBeNull();

    // Verify CONCEPT_DELETE audit log was created (requirement 9)
    const auditLog = await db.policyAuditLog.findFirst({
      where: {
        organizationId: TEST_ORG_A,
        action: 'CONCEPT_DELETE',
        targetType: 'POLICY_CONCEPT',
        targetId: concept.id,
      },
    });

    expect(auditLog).not.toBeNull();
    expect(auditLog?.actorId).toBe(TEST_ADMIN_A_ID);
  });

  it('DELETE /api/admin/concepts/[id] endpoint returns 404 for nonexistent concept', async () => {
    const nonexistentId = 'nonexistent-id-endpoint-999';
    const req = new NextRequest(`http://localhost:3000/api/admin/concepts/${nonexistentId}`, {
      method: 'DELETE',
    });

    const response = await DELETE(req, {
      params: Promise.resolve({ id: nonexistentId }),
    });

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain('not found');
  });

  it('DELETE /api/admin/concepts/[id] returns 404 when requested by user in another org', async () => {
    const concept = await createConcept({
      organizationId: TEST_ORG_A,
      documentId: TEST_DOC_A_ID,
      conceptKey: 'del_test_cross_org',
      name: 'Cross Org Delete',
      descriptionFa: 'تست حذف از سازمان دیگر',
      sensitivity: 'INTERNAL',
      action: 'ALLOW_EXTERNAL',
      sourceQuote: 'نقل قول سازمان الف',
      reviewStatus: 'REVIEW',
    });

    // Session is Org B
    mockSessionState.organizationId = TEST_ORG_B;

    const req = new NextRequest(`http://localhost:3000/api/admin/concepts/${concept.id}`, {
      method: 'DELETE',
    });

    const response = await DELETE(req, {
      params: Promise.resolve({ id: concept.id }),
    });

    expect(response.status).toBe(404);

    // Verify concept is NOT deleted in Org A
    const stillThere = await getConceptById(concept.id, TEST_ORG_A);
    expect(stillThere).not.toBeNull();

    // Reset session back to Org A
    mockSessionState.organizationId = TEST_ORG_A;
  });
});
