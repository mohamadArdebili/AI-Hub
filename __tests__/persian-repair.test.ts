import { describe, it, expect } from 'vitest';
import {
  repairPersianText,
  looksCorrupted,
} from '../src/lib/policy/persian-repair';

// ─── REAL corrupted text extracted from the user's actual PDF upload ────────
// (policy_2.pdf / SEPEHR-DATA-POLICY-001 — ligature-reversal damage)
const REAL_CHUNK_1 =
  'این سیاست تعیین میکند چه اطالعاتی میتواند به سرویس هوش مصنوعی  . ' +
  'خارج از محیط مورد اعتماد سازمان ارسال شود  کنرتل سیاست باید بر تمام محتوای قابل ارسال اعمال شود؛ شامل پیام جاری،  . ' +
  'تاریخچه گفتگو، منت فایلهای پیوست، منت بازیابیشده از اسنادوات افزودهشده به درخواست';

const REAL_CHUNK_2 =
  'ه حساب بانکی منتسب به شخص  یا مشرتی باید LOCAL_ONLY . شوند  به دلیل داشنت   `   ا هر رشته عددی صرف ۱۶ . ' +
  'رقم، شماره کارت محسوب نمیشود  . شماره سفارش و شناسه رهگیری غیرمالی مشمول این قاعده نیستند  ' +
  'قاعده HR-001 ـ اطالعات حقوق و مزایا  حقوق، پاداش، کسورات، دریافتی خالص و مزایای منتسب به یک کارمند';

describe('repairPersianText — ligature reversal fixes', () => {
  it('fixes لا → ال (اطلاعات family, incl. suffixed forms)', () => {
    const { text } = repairPersianText('اطالعات و اطالعاتی و سالمت');
    expect(text).toContain('اطلاعات');
    expect(text).toContain('اطلاعاتی');
    expect(text).toContain('سلامت');
    expect(text).not.toContain('اطالعات');
  });

  it('fixes تر → رت (کنترل، مشتری، دسترسی)', () => {
    const { text } = repairPersianText('کنرتل کیفیت و مشرتی و دسرتسی');
    expect(text).toContain('کنترل');
    expect(text).toContain('مشتری');
    expect(text).toContain('دسترسی');
  });

  it('fixes تن → نت (متن، داشتن، گرفتن)', () => {
    const { text } = repairPersianText('این منت را خواندم و داشنت را گرفنت');
    expect(text).toContain('متن');
    expect(text).toContain('داشتن');
    expect(text).toContain('گرفتن');
  });

  it('fixes بر → رب (معتبر)', () => {
    const { text } = repairPersianText('این کد ملی معترب است');
    expect(text).toContain('معتبر');
  });

  it('repairs the real corrupted chunk 1 (user data)', () => {
    const { text } = repairPersianText(REAL_CHUNK_1);
    expect(text).toContain('اطلاعاتی');
    expect(text).toContain('کنترل');
    expect(text).toContain('متن فایلهای');
    expect(text).not.toContain('کنرتل');
    expect(text).not.toContain('اطالعاتی');
    // standalone floating periods glue to the previous word
    expect(text).toContain('مصنوعی.');
  });

  it('repairs the real corrupted chunk 2 (user data)', () => {
    const { text } = repairPersianText(REAL_CHUNK_2);
    expect(text).toContain('مشتری');
    expect(text).toContain('داشتن');
    expect(text).toContain('قاعده HR-001 ـ اطلاعات');
    expect(text).not.toContain('مشرتی');
    expect(text).not.toContain('داشنت');
  });

  it('NEVER touches correct words containing ال / لا / نت / رت (protection)', () => {
    const clean =
      'سلام و سلامت و سالم سال الف الگو منتظر پرتقال مرتبط منتخب تربیت جالب عالی بالاخره حالا پرده';
    const { text, report } = repairPersianText(clean);
    expect(report.swappedTokens).toBe(0);
    expect(text).toContain('سلامت');
    expect(text).toContain('الگو');
    expect(text).toContain('منتظر');
    expect(text).toContain('پرتقال');
  });

  it('preserves Latin identifiers and mixed tokens', () => {
    const { text } = repairPersianText('سند SEPEHR-DATA-POLICY-001 و LOCAL_ONLY و API');
    expect(text).toContain('SEPEHR-DATA-POLICY-001');
    expect(text).toContain('LOCAL_ONLY');
    expect(text).toContain('API');
  });

  it('glues floating standalone punctuation (visual-order artifacts)', () => {
    const { text, report } = repairPersianText('سپهر  : نسخه 1.0  : شناسه ۱ . هدف');
    expect(report.gluedPunctuation).toBeGreaterThanOrEqual(2);
    expect(text).toContain('سپهر:');
    expect(text).toContain('۱.');
  });

  it('drops isolated ASCII noise between Persian tokens', () => {
    const { text, report } = repairPersianText('سازمان j آزمایشی و با ` کنترل');
    expect(report.junkRemoved).toBeGreaterThanOrEqual(1);
    expect(text).not.toMatch(/\bj\b/);
    expect(text).toContain('کنترل');
  });

  it('collapses immediate repeated phrases (extraction overlap artifacts)', () => {
    const { text, report } = repairPersianText(
      'آزمایشی بودن اطلاعات آزمایشی بودن اطلاعات یا ضرورت انجام فوری',
    );
    expect(report.collapsedRepeats).toBe(1);
    expect(text.match(/آزمایشی بودن/g)?.length).toBe(1);
  });

  it('returns empty text and zero report for empty input', () => {
    const { text, report } = repairPersianText('');
    expect(text).toBe('');
    expect(report.swappedTokens).toBe(0);
  });

  it('depth-2 repair fixes words with two corrupted pairs', () => {
    const { text } = repairPersianText('دسرتسیهای مشرتیان منتشر شد'); // دسترسی‌ها مشتریان
    expect(text).toContain('دسترسی');
    expect(text).toContain('مشتریان');
  });
});

describe('looksCorrupted', () => {
  it('flags the real corrupted chunks', () => {
    expect(looksCorrupted(REAL_CHUNK_1)).toBe(true);
    expect(looksCorrupted(REAL_CHUNK_2)).toBe(true);
  });

  it('does not flag clean Persian text', () => {
    expect(
      looksCorrupted(
        'سیاست حفاظت از داده و استفاده از سرویس‌های هوش مصنوعی سازمان آزمایشی سپهر نسخه 1.0',
      ),
    ).toBe(false);
    expect(looksCorrupted('')).toBe(false);
  });
});
