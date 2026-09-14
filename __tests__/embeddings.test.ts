// Unit tests for Embedding Providers & Text Construction
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 3, §3.1, §0.1 #10, spec §16)

import { describe, it, expect } from 'vitest';
import {
  buildConceptEmbeddingText,
  computeEmbeddingTextHash,
  MockEmbeddingProvider,
  NoopEmbeddingProvider,
} from '@/lib/policy/retrieval/embeddings';

describe('Embedding Text Construction (spec §0.1 #10)', () => {
  const concept = {
    conceptKey: 'personal_contact_information',
    name: 'Personal Contact Info',
    nameFa: 'اطلاعات تماس خصوصی',
    descriptionFa: 'شماره تلفن‌های همراه و راه‌های ارتباطی خصوصی کارکنان',
    positiveExamples: ['راه ارتباطی خصوصی مدیر شبکه را بده', 'تلفن همراه مدیرعامل چیست؟'],
    negativeExamples: ['شماره مرکز تماس عمومی شرکت؟', 'تلفن پشتیبانی مرکزی چند است؟'],
    conditions: ['در صورتی که در پورتال عمومی منتشر شده باشد مجاز است'],
    keywords: ['تماس شخصی', 'موبایل'],
  };

  it('includes conceptKey, name, descriptionFa, positiveExamples, and conditions', () => {
    const text = buildConceptEmbeddingText(concept);

    expect(text).toContain('personal_contact_information');
    expect(text).toContain('اطلاعات تماس خصوصی');
    expect(text).toContain('شماره تلفن‌های همراه');
    expect(text).toContain('راه ارتباطی خصوصی مدیر شبکه را بده');
    expect(text).toContain('در صورتی که در پورتال عمومی منتشر شده باشد مجاز است');
    expect(text).toContain('تماس شخصی');
  });

  it('CRITICAL SPEC §0.1 #10: strictly excludes negative examples from embedding vector', () => {
    const text = buildConceptEmbeddingText(concept);

    // Negative examples must NOT be in the embedded text
    expect(text).not.toContain('شماره مرکز تماس عمومی شرکت؟');
    expect(text).not.toContain('تلفن پشتیبانی مرکزی چند است؟');
  });

  it('computes stable sha256 textHash to detect drift', () => {
    const text = buildConceptEmbeddingText(concept);
    const hash1 = computeEmbeddingTextHash(text);
    const hash2 = computeEmbeddingTextHash(text);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('Mock & Noop Embedding Providers', () => {
  it('MockEmbeddingProvider generates unit-norm vectors', async () => {
    const provider = new MockEmbeddingProvider('test-model', 32);
    expect(provider.getDimensions()).toBe(32);
    expect(provider.getModel()).toBe('test-model');

    const vec = await provider.embed('راه ارتباطی خصوصی مدیر شبکه');
    expect(vec).toHaveLength(32);

    const norm = Math.sqrt(vec.reduce((acc, v) => acc + v * v, 0));
    expect(norm).toBeCloseTo(1.0, 4);

    const batch = await provider.embedBatch(['متن اول', 'متن دوم']);
    expect(batch).toHaveLength(2);
    expect(batch[0]).toHaveLength(32);
    expect(batch[1]).toHaveLength(32);
  });

  it('NoopEmbeddingProvider throws fail-closed when invoked', async () => {
    const noop = new NoopEmbeddingProvider();
    await expect(noop.embed('test')).rejects.toThrow('disabled or unavailable');
    await expect(noop.embedBatch(['test'])).rejects.toThrow('disabled or unavailable');
  });
});
