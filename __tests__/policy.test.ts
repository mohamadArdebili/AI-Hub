// Vitest tests for policy engine — Persian/Farsi descriptions

import { describe, it, expect, vi } from 'vitest';
import { evaluate } from '@/lib/policy/engine';
import { normalizePersian } from '@/lib/policy/normalize';
import type { PolicySnapshot, RuleInput, ChunkInput } from '@/lib/policy/types';

// ─── Exception handling mock control ─────────────────────────────────────
// We use vi.hoisted so the flag is available inside the vi.mock factory
const mockControl = vi.hoisted(() => ({
  forceError: false,
}));

vi.mock('@/lib/policy/normalize', async () => {
  const actual = await vi.importActual<typeof import('@/lib/policy/normalize')>(
    '@/lib/policy/normalize',
  );
  return {
    normalizePersian: vi.fn((...args: Parameters<typeof actual.normalizePersian>) => {
      if (mockControl.forceError) {
        throw new Error('خطای آزمایشی');
      }
      return actual.normalizePersian(...args);
    }),
  };
});

// ─── Seed rules (R-001 through R-008) ─────────────────────────────────────

function makeRules(): RuleInput[] {
  return [
    {
      id: 'rule-001',
      code: 'R-001',
      title: 'حفاظت از اطلاعات حقوق و دستمزد',
      keywords: ['حقوق', 'دستمزد', 'فیش حقوقی', 'پاداش', 'مزایا'],
      patterns: [],
      severity: 'CRITICAL',
      category: 'اطلاعات مالی',
      isActive: true,
    },
    {
      id: 'rule-002',
      code: 'R-002',
      title: 'حفاظت از اطلاعات هویتی',
      keywords: ['کد ملی', 'شماره ملی', 'شناسنامه', 'کدملی', 'اطلاعات هویتی'],
      patterns: [],
      severity: 'CRITICAL',
      category: 'داده‌های شخصی',
      isActive: true,
    },
    {
      id: 'rule-003',
      code: 'R-003',
      title: 'حفاظت از اطلاعات بانکی',
      keywords: ['شماره شبا', 'شماره کارت', 'حساب بانکی', 'شبا'],
      patterns: [],
      severity: 'HIGH',
      category: 'اطلاعات مالی',
      isActive: true,
    },
    {
      id: 'rule-004',
      code: 'R-004',
      title: 'حفاظت از اسناد محرمانه',
      keywords: ['قرارداد', 'صورت‌جلسه', 'هیئت مدیره', 'مذاکره', 'تفاهم‌نامه'],
      patterns: [],
      severity: 'HIGH',
      category: 'محرمانگی',
      isActive: true,
    },
    {
      id: 'rule-005',
      code: 'R-005',
      title: 'حفاظت از کلیدها و اعتبارنامه‌ها',
      keywords: ['کلید API', 'توکن', 'رمز عبور', 'API Key', 'اعتبارنامه'],
      patterns: [],
      severity: 'CRITICAL',
      category: 'امنیت',
      isActive: true,
    },
    {
      id: 'rule-006',
      code: 'R-006',
      title: 'حفاظت از اطلاعات مشتریان',
      keywords: ['مشتری', 'آدرس مشتری', 'شماره تماس مشتری', 'تاریخچه خرید', 'اطلاعات مشتری'],
      patterns: [],
      severity: 'HIGH',
      category: 'داده‌های شخصی',
      isActive: true,
    },
    {
      id: 'rule-007',
      code: 'R-007',
      title: 'حفاظت از اطلاعات استراتژیک',
      keywords: ['استراتژی', 'برنامه‌ریزی', 'بودجه', 'اهداف سازمانی', 'نقشه راه'],
      patterns: [],
      severity: 'MEDIUM',
      category: 'محرمانگی',
      isActive: true,
    },
    {
      id: 'rule-008',
      code: 'R-008',
      title: 'حفاظت از اطلاعات داخلی',
      keywords: ['اطلاعات داخلی', 'گزارش داخلی', 'مستندات سازمانی', 'داده عملیاتی', 'فرآیند داخلی'],
      patterns: [],
      severity: 'MEDIUM',
      category: 'محرمانگی',
      isActive: true,
    },
  ];
}

// ─── Mock restricted chunks for BM25 ──────────────────────────────────────
// NOTE: The BM25 tokenizer uses /[^\w\u200C]+/ which treats Persian letters
// as non-word chars. ZWNJ-only tokens would cause false positives, so we
// intentionally avoid ZWNJ in normalizedContent for test stability.

function makeChunks(): ChunkInput[] {
  return [
    {
      id: 'chunk-001',
      content:
        'حقوق دستمزد فیش حقوقی پاداش مزایای شغلی کارکنان مالیاتی محرمانه ممنوع',
      normalizedContent:
        'حقوق دستمزد فیش حقوقی پاداش مزایای شغلی کارکنان مالیاتی محرمانه ممنوع',
      isRestricted: true,
    },
    {
      id: 'chunk-002',
      content:
        'صورت جلسه هيات مديره تفاهم نامه قرارداد تجاري بودجه پيشنهادي',
      normalizedContent:
        'صورت جلسه هيات مديره تفاهم نامه قرارداد تجاري بودجه پيشنهادي',
      isRestricted: true,
    },
    {
      id: 'chunk-003',
      content: 'متن عمومی غیرمحرمانه',
      normalizedContent: 'متن عمومی غیرمحرمانه',
      isRestricted: false,
    },
  ];
}

function makeSnapshot(): PolicySnapshot {
  return { rules: makeRules(), chunks: makeChunks() };
}

const ORG_ID = 'test-org-001';

// ═══════════════════════════════════════════════════════════════════════════
// BLOCK scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe('سناریوهای مسدودسازی', () => {
  it('بازنویسی صورت‌جلسه محرمانه → BLOCK (رفتاری + کلمات کلیدی)', async () => {
    const prompt = 'این متن صورت‌جلسه محرمانه را بازنویسی کن: تصمیمات مهم هیئت مدیره در مورد بودجه';
    const result = await evaluate({
      prompt,
      organizationId: ORG_ID,
      policySnapshot: makeSnapshot(),
    });

    expect(result.action).toBe('BLOCK');
    expect(result.score).toBeGreaterThanOrEqual(0.5);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('بررسی قرارداد تجاری → BLOCK (کلمه کلیدی: قرارداد)', async () => {
    const prompt = 'لطفاً این قرارداد تجاری را بررسی کن و نقاط ضعف آن را مشخص کن';
    const result = await evaluate({
      prompt,
      organizationId: ORG_ID,
      policySnapshot: makeSnapshot(),
    });

    expect(result.action).toBe('BLOCK');
    expect(result.matchedRules.some((r) => r.code === 'R-004')).toBe(true);
  });

  it('تحلیل حقوق و دستمزد → BLOCK (کلمات کلیدی: حقوق، دستمزد)', async () => {
    const prompt = 'حقوق و دستمزد کارکنان بخش مالی را تحلیل کن';
    const result = await evaluate({
      prompt,
      organizationId: ORG_ID,
      policySnapshot: makeSnapshot(),
    });

    expect(result.action).toBe('BLOCK');
    expect(result.matchedRules.some((r) => r.code === 'R-001')).toBe(true);
  });

  it('کد ملی معتبر + رشته اتصال پایگاه داده → BLOCK (داده‌های حساس)', async () => {
    // 0921667582 has valid Iranian national ID checksum
    const prompt =
      'کد ملی 0921667582 را بررسی کن و این هم connection string: mongodb+srv://user:pass@host/db';
    const result = await evaluate({
      prompt,
      organizationId: ORG_ID,
      policySnapshot: makeSnapshot(),
    });

    expect(result.action).toBe('BLOCK');
    expect(result.score).toBe(1.0);
    // Should detect either national ID or connection string (or both)
    expect(result.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it('کد داخلی + کلید API → BLOCK (داده‌های حساس: کلید API)', async () => {
    const prompt = 'این کد داخلی را بررسی کن. کلید API: sk-abc123def456ghi789jkl012mno345';
    const result = await evaluate({
      prompt,
      organizationId: ORG_ID,
      policySnapshot: makeSnapshot(),
    });

    expect(result.action).toBe('BLOCK');
    expect(result.score).toBe(1.0);
    expect(result.matchedRules.some((r) => r.severity === 'CRITICAL')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ALLOW scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe('سناریوهای مجاز', () => {
  it('سؤال عمومی برنامه‌نویسی → ALLOW', async () => {
    const prompt = 'تفاوت بین REST و GraphQL را با مثال توضیح بده';
    const result = await evaluate({
      prompt,
      organizationId: ORG_ID,
      policySnapshot: makeSnapshot(),
    });

    expect(result.action).toBe('ALLOW');
    expect(result.matchedRules).toHaveLength(0);
  });

  it('ترجمه عمومی بدون شاخص محرمانگی → ALLOW', async () => {
    const prompt = 'این متن را به انگلیسی ترجمه کن: هوش مصنوعی آینده کسب‌وکار را متحول می‌کند';
    const result = await evaluate({
      prompt,
      organizationId: ORG_ID,
      policySnapshot: makeSnapshot(),
    });

    expect(result.action).toBe('ALLOW');
    expect(result.matchedRules).toHaveLength(0);
  });

  it('ایمیل بازاریابی عمومی → ALLOW', async () => {
    const prompt = 'یک ایمیل بازاریابی برای محصول جدید بنویس';
    const result = await evaluate({
      prompt,
      organizationId: ORG_ID,
      policySnapshot: makeSnapshot(),
    });

    expect(result.action).toBe('ALLOW');
    expect(result.matchedRules).toHaveLength(0);
  });

  it('سؤال آموزشی برنامه‌نویسی پایتون → ALLOW', async () => {
    const prompt = 'اصول اولیه برنامه‌نویسی پایتون را آموزش بده';
    const result = await evaluate({
      prompt,
      organizationId: ORG_ID,
      policySnapshot: makeSnapshot(),
    });

    expect(result.action).toBe('ALLOW');
    expect(result.matchedRules).toHaveLength(0);
  });

  it('خلاصه‌سازی خبر عمومی → ALLOW', async () => {
    const prompt = 'خبر امروز را خلاصه کن';
    const result = await evaluate({
      prompt,
      organizationId: ORG_ID,
      policySnapshot: makeSnapshot(),
    });

    expect(result.action).toBe('ALLOW');
    expect(result.matchedRules).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Fail-closed scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe('سناریوهای fail-closed', () => {
  it('عدم وجود سند سیاست فعال (snapshot = null) → BLOCK', async () => {
    const result = await evaluate({
      prompt: 'سؤال ساده',
      organizationId: ORG_ID,
      policySnapshot: null,
    });

    expect(result.action).toBe('BLOCK');
    expect(result.score).toBe(1.0);
    expect(
      result.reasons.some((r) => r.includes('ارزیابی سیاست')),
    ).toBe(true);
  });

  it('مدیریت خطا در موتور ارزیابی → BLOCK در صورت بروز خطا', async () => {
    // Pre-create snapshot before enabling the error flag
    const snapshot = makeSnapshot();
    mockControl.forceError = true;
    try {
      const result = await evaluate({
        prompt: 'متن تستی',
        organizationId: ORG_ID,
        policySnapshot: snapshot,
      });

      expect(result.action).toBe('BLOCK');
      expect(result.score).toBe(1.0);
      expect(result.matchedRules).toHaveLength(0);
      expect(
        result.reasons.some((r) => r.includes('خطا')),
      ).toBe(true);
    } finally {
      mockControl.forceError = false;
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Normalization tests
// ═══════════════════════════════════════════════════════════════════════════

describe('نرمال‌سازی متن فارسی', () => {
  it('تبدیل یای عربی (ي) به یای فارسی (ی)', () => {
    const arabicYeh = '\u064A'; // Arabic ي
    const persianYeh = '\u06CC'; // Persian ی
    const input = `مجر${arabicYeh}دين`;
    const result = normalizePersian(input);

    // Result must contain Persian yeh and NOT Arabic yeh
    expect(result).toContain(persianYeh);
    expect(result).not.toContain(arabicYeh);
    // After normalization, Arabic and Persian variants produce identical output
    expect(result).toBe(normalizePersian('مجریدین'));
  });

  it('تبدیل کاف عربی (ك) به کاف فارسی (ک)', () => {
    const arabicKaf = '\u0643'; // Arabic ك
    const persianKaf = '\u06A9'; // Persian ک
    const input = `${arabicKaf}تاب`;
    const expected = `${persianKaf}تاب`;

    expect(normalizePersian(input)).toBe(expected);
  });

  it('تبدیل ارقام فارسی به لاتین', () => {
    const input = '۱۲۳۴۵';
    const result = normalizePersian(input);

    expect(result).toBe('12345');
  });

  it('حفظ نیم‌فاصله (ZWNJ) بین حروف', () => {
    const ZWNJ = '\u200C';
    const input = `نیم${ZWNJ}فاصله`;
    const result = normalizePersian(input);

    expect(result).toContain(ZWNJ);
  });

  it('معادل بودن متن عربی و فارسی پس از نرمال‌سازی', () => {
    const arabicYeh = '\u064A';
    const arabicKaf = '\u0643';

    // Arabic variants should normalize to same output as Persian variants
    expect(normalizePersian(`مجر${arabicYeh}دين`)).toBe(
      normalizePersian('مجریدین'),
    );
    expect(normalizePersian(`${arabicKaf}تاب`)).toBe(
      normalizePersian('کتاب'),
    );
  });
});
