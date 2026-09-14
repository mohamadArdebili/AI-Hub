// Unit tests for PolicyConcept Zod schema & provenance validation
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 1, §1.3, §1.6, spec §12, §13, §43, Rule 10)

import { describe, it, expect } from 'vitest';
import {
  ExtractedConceptSchema,
  verifyQuoteProvenance,
  validateExtractedConcepts,
} from '@/lib/policy/concepts/validator';

describe('PolicyConcept Zod Schema (ExtractedConceptSchema)', () => {
  const validConceptSample = {
    conceptKey: 'personal_contact_information',
    name: 'Personal Contact Information',
    nameFa: 'اطلاعات تماس شخصی مدیران و کارکنان',
    descriptionFa: 'شامل شماره تلفن خصوصی، نشانی منزل و راه‌های ارتباطی غیررسمی کارکنان',
    category: 'حریم خصوصی',
    sensitivity: 'CONFIDENTIAL',
    action: 'ROUTE_LOCAL',
    positiveExamples: [
      'راه ارتباطی خصوصی مدیر شبکه را بده',
      'شماره تلفن همراه مستقیم مدیرعامل چیست؟',
    ],
    negativeExamples: [
      'شماره تماس عمومی روابط عمومی شرکت چیست؟',
      'تلفن پشتیبانی مرکزی چند است؟',
    ],
    conditions: ['در صورتی که شماره در پورتال عمومی شرکت منتشر شده باشد، مجاز است'],
    keywords: ['تماس شخصی', 'موبایل مدیر', 'تلفن همراه'],
    detectorHints: {
      regex: ['09\\d{9}'],
      checksum: [],
      dictionary: ['مدیران_ارشد'],
    },
    sourceQuote: 'شماره تلفن‌های همراه و راه‌های ارتباطی خصوصی کارکنان نباید افشا شوند.',
    sourcePage: 3,
    confidence: 0.95,
  };

  it('validates a complete, conformant policy concept', () => {
    const result = ExtractedConceptSchema.safeParse(validConceptSample);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conceptKey).toBe('personal_contact_information');
      expect(result.data.sensitivity).toBe('CONFIDENTIAL');
      expect(result.data.action).toBe('ROUTE_LOCAL');
      expect(result.data.positiveExamples).toHaveLength(2);
      expect(result.data.negativeExamples).toHaveLength(2);
      expect(result.data.sourceQuote).toContain('راه‌های ارتباطی خصوصی');
    }
  });

  it('strictly rejects concepts with missing or empty sourceQuote (Rule 10, spec §13)', () => {
    // Missing sourceQuote
    const { sourceQuote, ...noQuote } = validConceptSample;
    const resultNoQuote = ExtractedConceptSchema.safeParse(noQuote);
    expect(resultNoQuote.success).toBe(false);

    // Empty string sourceQuote
    const emptyQuote = { ...validConceptSample, sourceQuote: '' };
    const resultEmptyQuote = ExtractedConceptSchema.safeParse(emptyQuote);
    expect(resultEmptyQuote.success).toBe(false);

    // Whitespace only sourceQuote
    const wsQuote = { ...validConceptSample, sourceQuote: '   ' };
    const resultWsQuote = ExtractedConceptSchema.safeParse(wsQuote);
    expect(resultWsQuote.success).toBe(false);
  });

  it('strictly rejects invalid sensitivity levels', () => {
    const invalid = { ...validConceptSample, sensitivity: 'TOP_SECRET' };
    const result = ExtractedConceptSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('strictly rejects invalid actions', () => {
    const invalid = { ...validConceptSample, action: 'ALLOW' }; // legacy ALLOW is not ConceptAction
    const result = ExtractedConceptSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('supports MASK_AND_ALLOW_EXTERNAL as a valid first-class action (spec §0.1 #1)', () => {
    const masked = { ...validConceptSample, action: 'MASK_AND_ALLOW_EXTERNAL' };
    const result = ExtractedConceptSchema.safeParse(masked);
    expect(result.success).toBe(true);
  });

  it('strictly rejects empty descriptionFa or name', () => {
    const noDesc = { ...validConceptSample, descriptionFa: '' };
    expect(ExtractedConceptSchema.safeParse(noDesc).success).toBe(false);

    const noName = { ...validConceptSample, name: '   ' };
    expect(ExtractedConceptSchema.safeParse(noName).success).toBe(false);
  });

  it('validates identifier pattern for conceptKey', () => {
    const invalidKey = { ...validConceptSample, conceptKey: 'bad concept key with spaces' };
    expect(ExtractedConceptSchema.safeParse(invalidKey).success).toBe(false);

    const validKeyWithDashAndUnder = { ...validConceptSample, conceptKey: 'api-token_internal.v1' };
    expect(ExtractedConceptSchema.safeParse(validKeyWithDashAndUnder).success).toBe(true);
  });

  it('provides default empty arrays for examples, conditions, and keywords', () => {
    const minimal = {
      conceptKey: 'minimal_concept',
      name: 'Minimal Concept',
      descriptionFa: 'توضیحات فارسی مختصر',
      sensitivity: 'INTERNAL',
      action: 'ROUTE_LOCAL',
      sourceQuote: 'متن نقل قول الزامی از سند سیاست',
    };
    const result = ExtractedConceptSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.positiveExamples).toEqual([]);
      expect(result.data.negativeExamples).toEqual([]);
      expect(result.data.conditions).toEqual([]);
      expect(result.data.keywords).toEqual([]);
      expect(result.data.confidence).toBe(1.0);
    }
  });
});

describe('Provenance Verification (verifyQuoteProvenance)', () => {
  const documentText = `
فصل سوم: حفاظت از داده‌های ارتباطی پرسنل
ماده ۱۲: کلیه شماره تلفن‌های همراه شخصی، نشانی منزل و راه‌های ارتباطی خصوصی مدیران و کارمندان شرکت محرمانه تلقی می‌گردد.
هیچ‌یک از پرسنل مجاز به ارسال این مشخصات به سرویس‌های هوش مصنوعی بیرونی نیستند.
`.trim();

  it('verifies exact quote substring', () => {
    const quote = 'راه‌های ارتباطی خصوصی مدیران و کارمندان';
    expect(verifyQuoteProvenance(quote, documentText)).toBe(true);
  });

  it('verifies normalized Persian quote with Arabic vs Persian yaa/kaaf and digits', () => {
    // Document contains: 'کلیه شماره تلفن‌های همراه شخصی'
    // Quote with arabic yaa 'ي' and arabic kaaf 'ك' and persion digits
    const quoteArabic = 'كليه شماره تلفن‌هاي همراه شخصي';
    expect(verifyQuoteProvenance(quoteArabic, documentText)).toBe(true);
  });

  it('verifies quote with different whitespace spacing / line wraps', () => {
    const quoteWithNewlines = 'خصوصی مدیران و کارمندان\nشرکت محرمانه';
    expect(verifyQuoteProvenance(quoteWithNewlines, documentText)).toBe(true);
  });

  it('rejects quotes not in the source text', () => {
    const fabricatedQuote = 'اطلاعات حقوق ماهیانه اعضای هیئت مدیره باید فوراً حذف گردد.';
    expect(verifyQuoteProvenance(fabricatedQuote, documentText)).toBe(false);
  });

  it('rejects empty or whitespace quotes', () => {
    expect(verifyQuoteProvenance('', documentText)).toBe(false);
    expect(verifyQuoteProvenance('   ', documentText)).toBe(false);
  });
});

describe('validateExtractedConcepts parser & envelope', () => {
  const sourceText = 'بخش امنیت: اشتراک‌گذاری کلید‌های خصوصی سرورها و رمزهای عبور اکیداً ممنوع است.';

  it('parses direct array of concept objects', () => {
    const input = [
      {
        conceptKey: 'server_private_keys',
        name: 'Server Private Keys',
        descriptionFa: 'کلیدهای خصوصی و رمزهای سرور',
        sensitivity: 'HIGHLY_CONFIDENTIAL',
        action: 'BLOCK',
        sourceQuote: 'کلید‌های خصوصی سرورها و رمزهای عبور اکیداً ممنوع است',
      },
    ];

    const { valid, rejected } = validateExtractedConcepts(input);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
    expect(valid[0].conceptKey).toBe('server_private_keys');
    expect(valid[0].action).toBe('BLOCK');
  });

  it('parses JSON string envelope { concepts: [...] }', () => {
    const jsonString = JSON.stringify({
      concepts: [
        {
          conceptKey: 'server_keys',
          name: 'Server Keys',
          descriptionFa: 'کلیدهای سرور',
          sensitivity: 'HIGHLY_CONFIDENTIAL',
          action: 'BLOCK',
          sourceQuote: 'کلید‌های خصوصی سرورها',
        },
      ],
    });

    const { valid, rejected } = validateExtractedConcepts(jsonString);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('enforces provenance when requireProvenanceInSourceText is true', () => {
    const input = [
      {
        conceptKey: 'authentic_concept',
        name: 'Authentic Concept',
        descriptionFa: 'مفهوم معتبر برگرفته از متن',
        sensitivity: 'HIGHLY_CONFIDENTIAL',
        action: 'BLOCK',
        sourceQuote: 'کلید‌های خصوصی سرورها',
      },
      {
        conceptKey: 'hallucinated_concept',
        name: 'Hallucinated Concept',
        descriptionFa: 'مفهوم ساختگی بدون تطابق با متن',
        sensitivity: 'CONFIDENTIAL',
        action: 'ROUTE_LOCAL',
        sourceQuote: 'این جمله ابداً در متن وجود ندارد و مدل از خود ساخته است',
      },
    ];

    const { valid, rejected } = validateExtractedConcepts(input, {
      sourceText,
      requireProvenanceInSourceText: true,
    });

    expect(valid).toHaveLength(1);
    expect(valid[0].conceptKey).toBe('authentic_concept');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('Provenance violation');
  });

  it('rejects invalid JSON payloads gracefully', () => {
    const { valid, rejected } = validateExtractedConcepts('{ broken json');
    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain('Invalid JSON');
  });
});
