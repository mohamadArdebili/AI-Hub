// PDF Processor — extract text, chunk, and infer rules from policy PDFs

import fs from 'fs';
import path from 'path';
import {
  getPolicyDocumentById,
  updatePolicyDocumentStatus,
  createPolicyChunks,
  createPolicyRule,
  getMaxRuleCodeNumber,
  isUniqueConstraintViolation,
} from '@/lib/db';
import { normalizePersian } from '@/lib/policy/normalize';
import type { RuleSeverity } from '@prisma/client';

// ─── PDF Text Extraction ───────────────────────────────────────────────────

export async function extractTextFromPDF(filePath: string): Promise<string> {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const dataBuffer = fs.readFileSync(filePath);
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;

    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: { str?: string }) => item.str ?? '')
        .join(' ');
      pageTexts.push(pageText);
    }

    const fullText = pageTexts.join('\n').trim();

    if (fullText.length < 10) {
      throw new Error('متن قابل استخراج نیست؛ قواعد را دستی وارد کنید');
    }

    return fullText;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message === 'متن قابل استخراج نیست؛ قواعد را دستی وارد کنید'
    ) {
      throw err;
    }
    // Log the real cause server-side — the rethrown message is user-facing.
    console.error('[pdf-processor] PDF extraction failed:', err);
    throw new Error('متن قابل استخراج نیست؛ قواعد را دستی وارد کنید');
  }
}

// ─── Document Chunking ─────────────────────────────────────────────────────

const RESTRICTED_KEYWORDS = [
  'ممنوع',
  'محرمانه',
  'نباید',
  'مجاز نیست',
  'طبقه‌بندی‌شده',
  'سرّی',
  'محرمانگی',
  'طبقه بندی شده',
];

const MIN_CHUNK = 100;
const MAX_CHUNK = 800;
const OVERLAP = 50;

export function chunkDocument(
  text: string,
): Array<{ content: string; isRestricted: boolean }> {
  const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);

  const segments: string[] = [];
  for (const para of paragraphs) {
    if (para.length > MAX_CHUNK) {
      const sentences = para
        .split(/(?<=[\.٬؟!])\s*/)
        .filter((s) => s.trim().length > 0);
      segments.push(...sentences);
    } else {
      segments.push(para);
    }
  }

  const chunks: Array<{ content: string; isRestricted: boolean }> = [];
  let buffer = '';

  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    if (buffer.length === 0) {
      buffer = trimmed;
    } else if (buffer.length + trimmed.length + 1 <= MAX_CHUNK) {
      buffer = buffer + '\n' + trimmed;
    } else {
      if (buffer.length >= MIN_CHUNK) {
        chunks.push(makeChunk(buffer));
        buffer = buffer.slice(-OVERLAP) + ' ' + trimmed;
      } else {
        buffer = buffer + ' ' + trimmed;
      }
    }
  }

  if (buffer.trim().length > 0) {
    chunks.push(makeChunk(buffer.trim()));
  }

  const finalChunks: Array<{ content: string; isRestricted: boolean }> = [];
  for (const chunk of chunks) {
    if (chunk.content.length > MAX_CHUNK) {
      finalChunks.push(...splitLargeChunk(chunk.content));
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}

function makeChunk(content: string): { content: string; isRestricted: boolean } {
  const isRestricted = RESTRICTED_KEYWORDS.some((kw) => content.includes(kw));
  return { content, isRestricted };
}

function splitLargeChunk(
  content: string,
): Array<{ content: string; isRestricted: boolean }> {
  const result: Array<{ content: string; isRestricted: boolean }> = [];
  const parts = content
    .split(/(?<=[\.٬؟!])\s*/)
    .filter((s) => s.trim().length > 0);
  let buf = '';

  for (const part of parts) {
    if (buf.length + part.length + 1 > MAX_CHUNK && buf.length >= MIN_CHUNK) {
      result.push(makeChunk(buf.trim()));
      buf = buf.slice(-OVERLAP) + ' ' + part;
    } else {
      buf = buf + ' ' + part;
    }
  }

  if (buf.trim().length > 0) {
    result.push(makeChunk(buf.trim()));
  }

  return result;
}

// ─── Rule Extraction ────────────────────────────────────────────────────────

const CRITICAL_PHRASES = ['مطلقاً ممنوع', 'به‌هیچ‌وجه', 'به هیچ وجه'];
const HIGH_PHRASES = ['ممنوع', 'نباید', 'مجاز نیست'];
const MEDIUM_PHRASES = ['باید مراقب باشید', 'با احتیاط'];

const RESTRICTION_PHRASES = [
  'ممنوع', 'محرمانه', 'نباید', 'مجاز نیست', 'حذف شود', 'عدم افشای', 'جایز نیست',
];

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'داده‌های شخصی': ['شخصی', 'هویت', 'نام', 'آدرس', 'تلفن', 'ایمیل', 'کد ملی', 'شناسنامه'],
  'اطلاعات مالی': ['مالی', 'حساب', 'بانک', 'تراکنش', 'وجه', 'بودجه', 'قرارداد', 'فروش', 'خرید'],
  'امنیت': ['امنیت', 'رمز', 'احراز', 'دسترسی', 'ویروس', 'حمله', 'نفوذ', 'فایروال', 'رمزنگاری'],
  'محرمانگی': ['محرمانه', 'طبقه‌بندی', 'سرّی', 'سری', 'محدود', 'دسترسی محدود'],
};

const STOP_WORDS = new Set([
  'و', 'در', 'به', 'از', 'که', 'این', 'آن', 'با', 'برای', 'هم', 'تا', 'را',
  'همه', 'هر', 'یک', 'باید', 'است', 'می', 'توان', 'شود', 'نمی', 'خواهد', 'کرد',
  'دارد', 'نبود', 'بود', 'شد', 'نشود', 'کنند', 'نیز', 'اما', 'یا', 'پس', 'همچنین',
  'ضمناً', 'البته', 'اگر', 'چون', 'چرا', 'چه', 'کدام', 'هرگز', 'همواره', 'همیشه',
  'گاهی', 'غالباً', 'معمولاً', 'مثلاً', 'یعنی', 'لطفاً', 'حتماً', 'فقط', 'بسیار',
  'بیشتر', 'کمتر', 'حداقل', 'حداکثر', 'حدود', 'تقریباً', 'نسبتاً', 'کاملاً', 'قسمتاً',
  'عملاً', 'نظری', 'عملی', 'فنی', 'اداری', 'قانونی', 'حقوقی', 'مربوط', 'مورد',
  'ذیر', 'ذاتی', 'ماجرا', 'بخش', 'ماده', 'بند', 'تبصره', 'فصل', 'قسمت',
]);

export function extractRulesFromChunks(
  chunks: Array<{ content: string; index: number }>,
): Array<{
  title: string;
  body: string;
  keywords: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: string;
}> {
  const rules: Array<{
    title: string;
    body: string;
    keywords: string[];
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    category: string;
  }> = [];

  for (const chunk of chunks) {
    const { content, index } = chunk;

    const hasRestriction = RESTRICTION_PHRASES.some((phrase) => content.includes(phrase));
    const numberedMatch = content.match(/(بند|ماده|ماده\s*\d|تبصره|قانون|بخش)\s*[\d۰-۹]+/);
    const bulletMatch = content.match(/^[\-•●▪►◆\*]\s*/m);

    if (!hasRestriction && !numberedMatch && !bulletMatch) {
      continue;
    }

    let severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (CRITICAL_PHRASES.some((p) => content.includes(p))) {
      severity = 'CRITICAL';
    } else if (HIGH_PHRASES.some((p) => content.includes(p))) {
      severity = 'HIGH';
    } else if (MEDIUM_PHRASES.some((p) => content.includes(p))) {
      severity = 'MEDIUM';
    }

    let category = 'امنیت';
    let maxCatScore = 0;
    for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
      const score = kws.reduce((acc, kw) => acc + (content.includes(kw) ? 1 : 0), 0);
      if (score > maxCatScore) {
        maxCatScore = score;
        category = cat;
      }
    }

    let title = numberedMatch ? numberedMatch[0] : `قاعده ${index + 1}`;
    const firstSentence = content.match(/^(.{10,80}?(?:[\.٬؟]|$))/);
    if (firstSentence) {
      title = firstSentence[1].trim().slice(0, 80);
    }

    const keywords = extractKeywords(content);

    rules.push({ title, body: content, keywords, severity, category });
  }

  return rules;
}

function extractKeywords(text: string): string[] {
  const words = text
    .replace(/[\-\[\](){}*+?.\\^$|]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  const freq = new Map<string, number>();
  for (const word of words) {
    const clean = word.replace(/[۰-۹0-9.,;:!?؟،؛«»"'()\[\]{}]/g, '');
    if (clean.length < 3) continue;
    freq.set(clean, (freq.get(clean) ?? 0) + 1);
  }

  // Sort by frequency desc, take top 8
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word);
}

// ─── Main Orchestration ────────────────────────────────────────────────────

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'policy-docs');

export async function processPolicyDocument(
  documentId: string,
  organizationId: string,
): Promise<void> {
  try {
    // Update status to PROCESSING
    await updatePolicyDocumentStatus(documentId, 'PROCESSING');

    // Get document from DB
    const doc = await getPolicyDocumentById(documentId, organizationId);
    if (!doc) {
      await updatePolicyDocumentStatus(
        documentId,
        'FAILED',
        'سند یافت نشد',
      );
      return;
    }

    const filePath = path.join(UPLOADS_DIR, `${documentId}.pdf`);

    // Extract text from PDF
    const rawText = await extractTextFromPDF(filePath);

    // Normalize text
    const normalizedText = normalizePersian(rawText);

    // Chunk the document (use normalized text for chunks)
    const rawChunks = chunkDocument(rawText);
    const normChunks = chunkDocument(normalizedText);

    // Use the longer of the two chunk arrays for consistency
    const chunksToUse = normChunks.length >= rawChunks.length ? normChunks : rawChunks;

    // Extract rules from chunks (use raw text for rule extraction to preserve keywords)
    const rawChunksWithIndex = rawChunks.map((c, i) => ({
      content: c.content,
      index: i,
    }));
    const extractedRules = extractRulesFromChunks(rawChunksWithIndex);

    // Save chunks to DB
    const dbChunks = chunksToUse.map((chunk, i) => {
      const normContent = normalizePersian(chunk.content);
      return {
        documentId,
        index: i,
        content: chunk.content,
        normalizedContent: normContent,
        isRestricted: chunk.isRestricted,
      };
    });

    if (dbChunks.length > 0) {
      await createPolicyChunks(dbChunks);
    }

    // Save rules to DB.
    // Codes are unique per organization (@@unique([organizationId, code])), so
    // numbering must continue AFTER the highest existing `R-###` code of the
    // org (seed rules, manual rules, or rules from previously uploaded
    // documents) — otherwise the SECOND uploaded document always fails with
    // "Unique constraint failed on the fields: (organizationId, code)".
    let nextCodeNumber = (await getMaxRuleCodeNumber(organizationId)) + 1;

    for (const rule of extractedRules) {
      let saved = false;
      // Defensive retry: if a concurrent upload / manual rule grabs the same
      // code between our MAX query and the create, bump the number and retry.
      for (let attempt = 0; attempt < 100 && !saved; attempt++) {
        const code = `R-${String(nextCodeNumber).padStart(3, '0')}`;
        try {
          await createPolicyRule({
            documentId,
            organizationId,
            code,
            title: rule.title,
            body: rule.body,
            keywords: rule.keywords,
            patterns: [],
            severity: rule.severity as RuleSeverity,
            category: rule.category,
            isManual: false,
          });
          saved = true;
          nextCodeNumber++;
        } catch (err) {
          if (!isUniqueConstraintViolation(err)) throw err;
          nextCodeNumber++;
        }
      }
      if (!saved) {
        throw new Error('خطا در ذخیره قاعده: کد یکتا برای قاعده قابل تخصیص نیست');
      }
    }

    // Update document status to READY
    await updatePolicyDocumentStatus(
      documentId,
      'READY',
      undefined,
      normalizedText.length,
    );
  } catch (err) {
    const errorMessage = isUniqueConstraintViolation(err)
      ? 'خطا در ذخیره قواعد استخراج‌شده: کد قاعده تکراری بود'
      : err instanceof Error
        ? err.message
        : 'خطای ناشناخته در پردازش سند';
    await updatePolicyDocumentStatus(documentId, 'FAILED', errorMessage).catch(() => {
      // If status update fails, we can't do much
    });
  }
}
