import { describe, it, expect } from 'vitest';
import { extractStructuredRules } from '../src/lib/policy/pdf-processor';
import { resolveAnchorQuote, validateExtractionResponse } from '../src/lib/policy/local-llm-adapter';

// Clean SEPEHR-style policy text (as the user authored it)
const SEPEHR_PAGES = [
  {
    page: 1,
    text: `سیاست حفاظت از داده و استفاده از سرویس‌های هوش مصنوعی
سازمان آزمایشی سپهر
نسخه: 1.0

۳. قواعد حفاظت از اطلاعات

قاعده SEC-001 ـ اسرار احراز هویت
رمز عبور واقعی یا مقداری که به‌عنوان رمز عبور معرفی شده است،
کلید API، توکن دسترسی، کلید خصوصی و کد بازیابی حساب، اسرار احراز هویت محسوب می‌شوند.
درخواست حاوی این اطلاعات باید BLOCKED شود.

قاعده PII-001 ـ اطلاعات هویتی و تماس
کد ملی معتبر و شماره تماس شخصی باید LOCAL_ONLY شوند.
نام فرد به‌تنهایی مشمول این قاعده نیست.

قاعده FIN-001 ـ اطلاعات حساب و پرداخت
شماره کارت معتبر و شماره شبا معتبر باید LOCAL_ONLY شوند.
شماره سفارش مشمول این قاعده نیست.`,
  },
  {
    page: 2,
    text: `قاعده HR-001 ـ اطلاعات حقوق و مزایا
حقوق و پاداش منتسب به یک کارمند باید LOCAL_ONLY شود.

۵. تقدم قواعد
BLOCKED بر LOCAL_ONLY مقدم است.`,
  },
];

describe('extractStructuredRules', () => {
  it('extracts one rule per «قاعده XXX-NNN» header', () => {
    const rules = extractStructuredRules(SEPEHR_PAGES);
    expect(rules.length).toBe(4);
    const codes = rules.map((r) => r.policyCode);
    expect(codes).toEqual(['SEC-001', 'PII-001', 'FIN-001', 'HR-001']);
  });

  it('maps BLOCKED → CRITICAL, LOCAL_ONLY → HIGH', () => {
    const rules = extractStructuredRules(SEPEHR_PAGES);
    const sec = rules.find((r) => r.policyCode === 'SEC-001');
    const pii = rules.find((r) => r.policyCode === 'PII-001');
    expect(sec?.severity).toBe('CRITICAL');
    expect(pii?.severity).toBe('HIGH');
    expect(sec?.action).toBe('BLOCK_EXTERNAL');
  });

  it('derives title, category and page provenance', () => {
    const rules = extractStructuredRules(SEPEHR_PAGES);
    const sec = rules.find((r) => r.policyCode === 'SEC-001');
    expect(sec?.title).toContain('SEC-001');
    expect(sec?.title).toContain('اسرار احراز هویت');
    expect(sec?.category).toBe('امنیت');
    expect(sec?.page).toBe(1);
    const hr = rules.find((r) => r.policyCode === 'HR-001');
    expect(hr?.page).toBe(2);
    expect(hr?.category).toBe('منابع انسانی');
  });

  it('body is a verbatim slice of the source text (clean, no chunk noise)', () => {
    const rules = extractStructuredRules(SEPEHR_PAGES);
    const fin = rules.find((r) => r.policyCode === 'FIN-001');
    expect(fin?.body).toContain('شماره کارت معتبر');
    expect(fin?.body).not.toContain('قاعده HR-001');
    const fullText = SEPEHR_PAGES.map((p) => p.text).join('\n');
    expect(fullText.replace(/\s+/g, ' ')).toContain(
      (fin?.body ?? '').replace(/\s+/g, ' '),
    );
  });

  it('stable textHash — same doc reprocessed yields identical hashes', () => {
    const a = extractStructuredRules(SEPEHR_PAGES);
    const b = extractStructuredRules(SEPEHR_PAGES);
    expect(a.map((r) => r.textHash)).toEqual(b.map((r) => r.textHash));
  });

  it('section headers terminate rule bodies', () => {
    const rules = extractStructuredRules(SEPEHR_PAGES);
    const hr = rules.find((r) => r.policyCode === 'HR-001');
    expect(hr?.body).not.toContain('تقدم قواعد');
  });

  it('returns [] for unstructured text (<2 headers)', () => {
    expect(extractStructuredRules([{ page: 1, text: 'متن بدون قاعده مشخص' }])).toEqual([]);
  });
});

describe('resolveAnchorQuote (anchor-based LLM extraction)', () => {
  const chunk =
    'قاعده SEC-001 ـ اسرار احراز هویت: رمز عبور واقعی و کلید API باید BLOCKED شود. قاعده PII-001 ـ کد ملی باید LOCAL_ONLY شود.';

  it('slices a verbatim quote even when the anchor has typos', () => {
    // anchor with a corrupted word (اطالعات-style) + dropped word
    const quote = resolveAnchorQuote(chunk, 'قاعده SEC-001 اسرار احراز هویت رمز عبور واقعی');
    expect(quote).not.toBeNull();
    expect(chunk.replace(/\s+/g, ' ')).toContain((quote ?? '').replace(/\s+/g, ' '));
    expect(quote).toContain('SEC-001');
  });

  it('stops at the next «قاعده …» header', () => {
    const quote = resolveAnchorQuote(chunk, 'قاعده SEC-001 اسرار احراز هویت');
    expect(quote).not.toBeNull();
    expect(quote).not.toContain('PII-001');
  });

  it('returns null for an anchor that does not exist (fail-closed)', () => {
    expect(resolveAnchorQuote(chunk, 'خرید ملک در شمال شهر تهران انجام شد')).toBeNull();
  });

  it('tolerates ZWNJ/punctuation differences between anchor and chunk', () => {
    const quote = resolveAnchorQuote(
      'متن با فاصله‌گذاری متفاوت و «گیومه» موجود است اینجا.',
      'متن با فاصله گذاری متفاوت و گیومه موجود',
    );
    expect(quote).not.toBeNull();
    expect(quote).toContain('فاصله‌گذاری');
  });
});

describe('validateExtractionResponse (v2 contract)', () => {
  const chunk =
    'قاعده SEC-001 ـ اسرار احراز هویت: رمز عبور واقعی باید BLOCKED شود.';

  const baseRule = {
    label: 'sec_001_secrets',
    category: 'security',
    detectorType: 'SEMANTIC',
    action: 'BLOCK_EXTERNAL',
    priority: 10,
    confidence: 0.9,
  };

  it('accepts rules with a resolvable anchor and returns the sliced quote', () => {
    const res = validateExtractionResponse(chunk, {
      rules: [{ ...baseRule, anchor: 'قاعده SEC-001 اسرار احراز هویت رمز عبور' }],
    });
    expect(res.rules.length).toBe(1);
    expect(res.ruleQuotes[0]).toContain('SEC-001');
    expect(chunk.replace(/\s+/g, ' ')).toContain(
      res.ruleQuotes[0].replace(/\s+/g, ' '),
    );
    expect(res.rejected.length).toBe(0);
  });

  it('rejects rules whose anchor cannot be resolved (ANCHOR_NOT_FOUND_IN_SOURCE)', () => {
    const res = validateExtractionResponse(chunk, {
      rules: [{ ...baseRule, anchor: 'این جمله در چانک وجود خارج ندارد هیچ' }],
    });
    expect(res.rules.length).toBe(0);
    expect(res.rejected[0]?.reason).toBe('ANCHOR_NOT_FOUND_IN_SOURCE');
  });

  it('legacy path: verbatim sourceQuote still accepted without anchor', () => {
    const res = validateExtractionResponse(chunk, {
      sourceQuote: 'قاعده SEC-001 ـ اسرار احراز هویت',
      rules: [baseRule],
    });
    expect(res.rules.length).toBe(1);
    expect(res.sourceQuote).toContain('SEC-001');
  });

  it('legacy path: non-verbatim sourceQuote → rules rejected', () => {
    const res = validateExtractionResponse(chunk, {
      sourceQuote: 'این نقل قول عینا در متن نیست',
      rules: [baseRule],
    });
    expect(res.rules.length).toBe(0);
    expect(res.rejected[0]?.reason).toBe('QUOTE_NOT_FOUND_IN_SOURCE');
  });

  it('malformed response → MALFORMED_RESPONSE, never throws', () => {
    const res = validateExtractionResponse(chunk, null);
    expect(res.rejected[0]?.reason).toBe('MALFORMED_RESPONSE');
    expect(res.rules.length).toBe(0);
  });

  it('invalid rules (bad detectorType) → INVALID_RULE', () => {
    const res = validateExtractionResponse(chunk, {
      rules: [{ ...baseRule, detectorType: 'NONSENSE' }],
    });
    expect(res.rejected[0]?.reason).toBe('INVALID_RULE');
  });
});
