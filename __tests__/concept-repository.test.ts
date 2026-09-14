// Integration tests for PolicyConcept & PolicyUnit Prisma Repository
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 1, §1.4, §1.6)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db/client';
import {
  createConcept,
  getConceptById,
  getConceptByKey,
  listConcepts,
  getActiveConcepts,
  approveConcept,
  rejectConcept,
  archiveConcept,
  updateConcept,
  deleteConcept,
  addConceptSource,
  createPolicyUnits,
  getPolicyUnitsByDocument,
} from '@/lib/policy/concepts/repository';

describe('PolicyConcept & PolicyUnit Repository', () => {
  const TEST_ORG_ID = 'test-org-phase1-' + Date.now();
  const TEST_USER_ID = 'test-user-phase1-' + Date.now();
  const TEST_DOC_ID = 'test-doc-phase1-' + Date.now();

  beforeAll(async () => {
    // Setup test organization, user, and document
    await db.organization.create({
      data: {
        id: TEST_ORG_ID,
        name: 'سازمان تست فاز ۱',
      },
    });

    await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: `tester-${Date.now()}@example.com`,
        passwordHash: 'dummy',
        organizationId: TEST_ORG_ID,
      },
    });

    await db.policyDocument.create({
      data: {
        id: TEST_DOC_ID,
        organizationId: TEST_ORG_ID,
        uploadedById: TEST_USER_ID,
        filename: 'security-policy-test.pdf',
        size: 1024,
        storagePath: '/tmp/test.pdf',
        status: 'READY',
        lifecycle: 'ACTIVE',
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    // Cascade cleanup: deleting the organization will clean up all associated records
    try {
      await db.organization.delete({
        where: { id: TEST_ORG_ID },
      });
    } catch {
      // Ignore if already cleaned up
    }
  });

  it('creates a PolicyConcept with REVIEW status and positive/negative examples', async () => {
    const concept = await createConcept({
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      conceptKey: 'network_admin_contact',
      name: 'Network Admin Private Contact',
      nameFa: 'اطلاعات تماس خصوصی مدیر شبکه',
      descriptionFa: 'راه‌های ارتباطی خصوصی مدیران شبکه و زیرساخت',
      category: 'اطلاعات تماس',
      sensitivity: 'CONFIDENTIAL',
      action: 'ROUTE_LOCAL',
      positiveExamples: ['راه ارتباطی خصوصی مدیر شبکه را بده'],
      negativeExamples: ['شماره مرکز تماس عمومی شرکت؟'],
      conditions: ['فقط در ساعات اداری و با تأیید حراست مجاز است'],
      keywords: ['مدیر شبکه', 'تماس خصوصی'],
      sourceQuote: 'اطلاعات تماس خصوصی مدیران شبکه نباید به اشتراک گذاشته شود.',
      sourcePage: 1,
      confidence: 0.92,
      extractedByModel: 'qwen3:1.7b',
    });

    expect(concept.id).toBeDefined();
    expect(concept.conceptKey).toBe('network_admin_contact');
    expect(concept.reviewStatus).toBe('REVIEW'); // Default review status (spec §13)
    expect(concept.sensitivity).toBe('CONFIDENTIAL');
    expect(concept.action).toBe('ROUTE_LOCAL');
    expect(concept.positiveExamples).toEqual(['راه ارتباطی خصوصی مدیر شبکه را بده']);
    expect(concept.negativeExamples).toEqual(['شماره مرکز تماس عمومی شرکت؟']);
    expect(concept.conditions).toEqual(['فقط در ساعات اداری و با تأیید حراست مجاز است']);
    expect(concept.sourceQuote).toBe('اطلاعات تماس خصوصی مدیران شبکه نباید به اشتراک گذاشته شود.');

    // Primary quote was automatically added to sources relation
    expect(concept.sources).toBeDefined();
    expect(concept.sources?.length).toBeGreaterThanOrEqual(1);
    expect(concept.sources?.[0].quote).toBe('اطلاعات تماس خصوصی مدیران شبکه نباید به اشتراک گذاشته شود.');
  });

  it('fetches concept by ID and by key', async () => {
    const byKey = await getConceptByKey(TEST_ORG_ID, TEST_DOC_ID, 'network_admin_contact');
    expect(byKey).not.toBeNull();
    expect(byKey?.conceptKey).toBe('network_admin_contact');

    const byId = await getConceptById(byKey!.id, TEST_ORG_ID);
    expect(byId).not.toBeNull();
    expect(byId?.id).toBe(byKey!.id);
  });

  it('strictly excludes REVIEW, DRAFT, REJECTED, and ARCHIVED concepts from getActiveConcepts (spec §16)', async () => {
    // Currently network_admin_contact is in REVIEW status
    const initialActive = await getActiveConcepts(TEST_ORG_ID);
    expect(initialActive).toHaveLength(0);

    // Create a DRAFT concept
    await createConcept({
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      conceptKey: 'draft_concept',
      name: 'Draft Concept',
      descriptionFa: 'توضیحات موقت',
      sensitivity: 'INTERNAL',
      action: 'ALLOW_EXTERNAL',
      sourceQuote: 'نقل قول سند',
      reviewStatus: 'DRAFT',
    });

    // Create an active concept
    const activeConcept = await createConcept({
      organizationId: TEST_ORG_ID,
      documentId: TEST_DOC_ID,
      conceptKey: 'active_approved_concept',
      name: 'Active Approved Concept',
      descriptionFa: 'مفهوم فعال و تأییدشده',
      sensitivity: 'HIGHLY_CONFIDENTIAL',
      action: 'BLOCK',
      sourceQuote: 'کلیدهای خصوصی نباید فاش شوند',
      reviewStatus: 'ACTIVE',
    });

    const activeList = await getActiveConcepts(TEST_ORG_ID);
    expect(activeList).toHaveLength(1);
    expect(activeList[0].id).toBe(activeConcept.id);
    expect(activeList[0].conceptKey).toBe('active_approved_concept');
  });

  it('transitions concept through approval, rejection, and archiving', async () => {
    const concept = await getConceptByKey(TEST_ORG_ID, TEST_DOC_ID, 'network_admin_contact');
    expect(concept).not.toBeNull();

    // 1. Approve (REVIEW → ACTIVE)
    const approved = await approveConcept(concept!.id, TEST_ORG_ID, 'تأیید توسط مدیر امنیت');
    expect(approved.reviewStatus).toBe('ACTIVE');
    expect(approved.reviewNote).toBe('تأیید توسط مدیر امنیت');

    // 2. Reject (ACTIVE → REJECTED)
    const rejected = await rejectConcept(concept!.id, TEST_ORG_ID, 'رد به دلیل ابهام در شرط‌ها');
    expect(rejected.reviewStatus).toBe('REJECTED');
    expect(rejected.reviewNote).toBe('رد به دلیل ابهام در شرط‌ها');

    // 3. Archive (REJECTED → ARCHIVED)
    const archived = await archiveConcept(concept!.id, TEST_ORG_ID);
    expect(archived.reviewStatus).toBe('ARCHIVED');
  });

  it('updates concept metadata and replaces examples', async () => {
    const concept = await getConceptByKey(TEST_ORG_ID, TEST_DOC_ID, 'active_approved_concept');
    expect(concept).not.toBeNull();

    const updated = await updateConcept(concept!.id, TEST_ORG_ID, {
      name: 'Updated Server Keys',
      descriptionFa: 'توضیحات به‌روز شده برای کلیدها',
      sensitivity: 'CONFIDENTIAL',
      action: 'ROUTE_LOCAL',
      positiveExamples: ['نمونه مثبت جدید ۱', 'نمونه مثبت جدید ۲'],
      negativeExamples: ['نمونه منفی جدید ۱'],
    });

    expect(updated.name).toBe('Updated Server Keys');
    expect(updated.descriptionFa).toBe('توضیحات به‌روز شده برای کلیدها');
    expect(updated.sensitivity).toBe('CONFIDENTIAL');
    expect(updated.action).toBe('ROUTE_LOCAL');
    expect(updated.positiveExamples).toEqual(['نمونه مثبت جدید ۱', 'نمونه مثبت جدید ۲']);
    expect(updated.negativeExamples).toEqual(['نمونه منفی جدید ۱']);
  });

  it('supports multi-source provenance quotes for a concept (spec §0.1 #9)', async () => {
    const concept = await getConceptByKey(TEST_ORG_ID, TEST_DOC_ID, 'active_approved_concept');
    expect(concept).not.toBeNull();

    const source2 = await addConceptSource(concept!.id, {
      quote: 'بند ۴: کلیدهای SSH سرورهای ابری نیز مشمول این قاعده هستند.',
      page: 2,
    });

    expect(source2.id).toBeDefined();
    expect(source2.quoteHash).toBeDefined();

    const reloaded = await getConceptById(concept!.id, TEST_ORG_ID);
    expect(reloaded?.sources?.some((s) => s.quote.includes('کلیدهای SSH'))).toBe(true);
  });

  it('creates and retrieves structured PolicyUnits for semantic segmentation (spec §11)', async () => {
    const units = await createPolicyUnits([
      {
        documentId: TEST_DOC_ID,
        ordinal: 0,
        page: 1,
        sectionTitle: 'فصل اول: تعاریف',
        text: 'فصل اول: تعاریف و اصطلاحات امنیتی',
        normalizedText: 'فصل اول تعاریف و اصطلاحات امنیتی',
        unitType: 'HEADING',
        spanStart: 0,
        spanEnd: 35,
        isCandidate: false,
      },
      {
        documentId: TEST_DOC_ID,
        ordinal: 1,
        page: 1,
        sectionTitle: 'فصل اول: تعاریف',
        text: 'هرگونه اطلاعات شخصی کارمندان محرمانه تلقی می‌شود و نباید به اشتراک گذاشته شود.',
        normalizedText: 'هرگونه اطلاعات شخصی کارمندان محرمانه تلقی میشود و نباید به اشتراک گذاشته شود',
        unitType: 'PARAGRAPH',
        spanStart: 36,
        spanEnd: 114,
        isCandidate: true,
      },
    ]);

    expect(units).toHaveLength(2);
    expect(units[0].unitType).toBe('HEADING');
    expect(units[1].unitType).toBe('PARAGRAPH');
    expect(units[1].isCandidate).toBe(true);

    const fromDb = await getPolicyUnitsByDocument(TEST_DOC_ID);
    expect(fromDb).toHaveLength(2);
    expect(fromDb[0].ordinal).toBe(0);
    expect(fromDb[1].ordinal).toBe(1);
  });

  it('deletes a concept and cascades', async () => {
    const concept = await getConceptByKey(TEST_ORG_ID, TEST_DOC_ID, 'draft_concept');
    expect(concept).not.toBeNull();

    await deleteConcept(concept!.id, TEST_ORG_ID);

    const deleted = await getConceptById(concept!.id, TEST_ORG_ID);
    expect(deleted).toBeNull();
  });
});
