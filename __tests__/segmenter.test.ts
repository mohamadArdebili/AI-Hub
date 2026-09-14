// Unit tests for Structural Document Segmenter (spec §10, §11, §42)
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 2, §2.2, §2.9)

import { describe, it, expect } from 'vitest';
import {
  segmentDocument,
  isCandidateUnit,
  splitSentences,
} from '@/lib/policy/ingestion/segmenter';
import type { ExtractedPage } from '@/lib/policy/ingestion/pdf-extractor';

describe('Document Segmenter (segmentDocument)', () => {
  it('correctly segments headings, clauses, paragraphs, bullets, and tables', () => {
    const text = `
فصل دوم: امنیت دسترسی و حساب‌های کاربری
ماده ۷: دسترسی به سامانه‌های حساس فقط با احراز هویت دوعاملی مجاز است.
پرسنل موظفند موارد زیر را رعایت فرمایند:
- عدم افشای رمز عبور به همکاران
- تغییر رمز عبور در دوره‌های سه ماهه
- گزارش هرگونه تلاش نفوذ به تیم حراست

| سطح دسترسی | نوع حساب | مجوز خروج اطلاعات |
| مدیر سیستم | ویژه | ممنوع |
| کاربر عادی | عمومی | محدود |

این یک پاراگراف عمومی در انتهای بخش است که توضیحات تکمیلی ارائه می‌دهد.
`.trim();

    const pages: ExtractedPage[] = [{ page: 1, text }];
    const units = segmentDocument(pages);

    expect(units.length).toBeGreaterThanOrEqual(5);

    // 1. Heading
    const heading = units.find((u) => u.unitType === 'HEADING');
    expect(heading).toBeDefined();
    expect(heading?.text).toContain('فصل دوم');

    // 2. Clause
    const clause = units.find((u) => u.unitType === 'CLAUSE');
    expect(clause).toBeDefined();
    expect(clause?.text).toContain('ماده ۷');

    // 3. Bullet group
    const bulletGroup = units.find((u) => u.unitType === 'BULLET_GROUP');
    expect(bulletGroup).toBeDefined();
    expect(bulletGroup?.text).toContain('عدم افشای رمز عبور');
    expect(bulletGroup?.text).toContain('تغییر رمز عبور');

    // 4. Table
    const table = units.find((u) => u.unitType === 'TABLE');
    expect(table).toBeDefined();
    expect(table?.text).toContain('سطح دسترسی');
    expect(table?.text).toContain('مدیر سیستم');

    // 5. Paragraph
    const para = units.find((u) => u.unitType === 'PARAGRAPH');
    expect(para).toBeDefined();
    expect(para?.text).toContain('پاراگراف عمومی');
  });

  it('strictly preserves sentence integrity and never breaks a sentence in the middle (spec §10)', () => {
    const longSentence1 = 'جمله اول بسیار مهم است که نباید به هیچ وجه در میانه کلماتش شکسته شود.';
    const longSentence2 = 'جمله دوم شامل جزئیات بیشتری درباره سیاست‌های محرمانگی سازمان سپهر است.';
    const longSentence3 = 'جمله سوم تأکید می‌کند که اشتراک‌گذاری کلید‌های خصوصی سرورها اکیداً ممنوع اعلام شده است.';
    const longText = `${longSentence1} ${longSentence2} ${longSentence3}`;

    // Target max unit length smaller than the whole text to force sentence splitting
    const pages: ExtractedPage[] = [{ page: 1, text: longText }];
    const units = segmentDocument(pages, { maxUnitLength: 100 });

    expect(units.length).toBeGreaterThan(1);
    for (const u of units) {
      // Each unit must be composed of complete sentences
      const containsCompleteSentence =
        u.text === longSentence1 ||
        u.text === longSentence2 ||
        u.text === longSentence3 ||
        u.text === `${longSentence1} ${longSentence2}` ||
        u.text === `${longSentence2} ${longSentence3}`;
      expect(containsCompleteSentence).toBe(true);
    }
  });

  it('marks candidate units based on restricted keywords for LLM prioritization (spec §42)', () => {
    expect(isCandidateUnit('این یک متن عادی بدون حساسیت است')).toBe(false);
    expect(isCandidateUnit('ارسال این اطلاعات به بیرون اکیداً ممنوع است')).toBe(true);
    expect(isCandidateUnit('رمز عبور و کلید خصوصی پرسنل')).toBe(true);
    expect(isCandidateUnit('اسناد محرمانه طبقه‌بندی شده')).toBe(true);

    const pages: ExtractedPage[] = [
      {
        page: 1,
        text: `
فصل یک: کلیات
این یک متن مقدماتی عمومی است.
ماده ۲: افشای اطلاعات حساب بانکی و شماره شبا ممنوع است.
`.trim(),
      },
    ];

    const units = segmentDocument(pages);
    const candidateClause = units.find((u) => u.text.includes('شماره شبا'));
    expect(candidateClause?.isCandidate).toBe(true);
  });
});
