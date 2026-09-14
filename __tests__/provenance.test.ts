// Unit tests for Provenance Verification & Multi-Source Tracking
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 2, §2.5, §2.9, spec §13, Rule 10)

import { describe, it, expect } from 'vitest';
import {
  verifyConceptProvenance,
  filterConceptsByProvenance,
} from '@/lib/policy/ingestion/provenance';
import type { ExtractedConcept } from '@/lib/policy/concepts/validator';

describe('Provenance Verification (verifyConceptProvenance)', () => {
  const unitText = `
ماده ۴: اشتراک‌گذاری توکن‌های دسترسی API و کلید‌های احراز هویت سرورهای ابری با هرگونه سیستم خارجی ممنوع است.
کارکنان باید فقط از درگاه‌های داخلی تأییدشده استفاده نمایند.
`.trim();

  const baseConcept: ExtractedConcept = {
    conceptKey: 'api_tokens',
    name: 'API Tokens',
    nameFa: 'توکن‌های API',
    descriptionFa: 'توکن‌های دسترسی و کلید‌های احراز هویت',
    category: 'امنیت',
    sensitivity: 'HIGHLY_CONFIDENTIAL',
    action: 'BLOCK',
    positiveExamples: ['توکن دسترسی API سامانه را بده'],
    negativeExamples: ['مستندات عمومی API کجاست؟'],
    conditions: [],
    keywords: ['توکن API'],
    sourceQuote: 'اشتراک‌گذاری توکن‌های دسترسی API و کلید‌های احراز هویت سرورهای ابری با هرگونه سیستم خارجی ممنوع است.',
    confidence: 1.0,
  };

  it('accepts concept when sourceQuote is verbatim substring of unit text', () => {
    const result = verifyConceptProvenance(baseConcept, unitText);
    expect(result.valid).toBe(true);
    expect(result.sourceQuote).toBe(baseConcept.sourceQuote);
  });

  it('accepts concept with Persian ligature / numeral / yaa-kaaf normalizations in quote', () => {
    const quoteNormalized = {
      ...baseConcept,
      sourceQuote: 'اشتراك‌گذاري توكن‌هاي دسترسي API و كليد‌هاي احراز هويت', // Arabic yaa/kaaf
    };
    const result = verifyConceptProvenance(quoteNormalized, unitText);
    expect(result.valid).toBe(true);
  });

  it('strictly rejects concepts with hallucinated quotes not in unit text (Rule 10)', () => {
    const hallucinated = {
      ...baseConcept,
      sourceQuote: 'حقوق و دستمزد ماهانه کارمندان نباید فاش گردد.',
    };
    const result = verifyConceptProvenance(hallucinated, unitText);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('sourceQuote was not found');
  });

  it('strictly rejects concepts with empty quote', () => {
    const emptyQuote = {
      ...baseConcept,
      sourceQuote: '',
    };
    const result = verifyConceptProvenance(emptyQuote, unitText);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing mandatory sourceQuote');
  });

  it('filterConceptsByProvenance separates accepted from rejected concepts', () => {
    const concepts: ExtractedConcept[] = [
      baseConcept,
      {
        ...baseConcept,
        conceptKey: 'hallucinated_one',
        sourceQuote: 'این جمله کاملاً خیالی است و در متن وجود ندارد',
      },
    ];

    const { accepted, rejected } = filterConceptsByProvenance(concepts, {
      text: unitText,
      page: 2,
    });

    expect(accepted).toHaveLength(1);
    expect(accepted[0].conceptKey).toBe('api_tokens');
    expect(accepted[0].sourcePage).toBe(2);

    expect(rejected).toHaveLength(1);
    expect(rejected[0].concept.conceptKey).toBe('hallucinated_one');
  });
});
