// PDF Processor — extract text, chunk, and infer rules from policy PDFs
// Sensitive-Data Layer: page-aware extraction (provenance), 800–1200 char
// chunking with overlap, deterministic filters, pluggable Local-LLM rule
// proposal (PENDING_LLM on unavailability), audit logging. No external LLM.

import fs from 'fs';
import path from 'path';
import {
  getPolicyDocumentById,
  updatePolicyDocumentStatus,
  createPolicyChunks,
  getPolicyChunks,
  createPolicyRule,
  findRuleByTextHash,
  getMaxRuleCodeNumber,
  isUniqueConstraintViolation,
  createPolicyAuditLog,
} from '@/lib/db';
import { normalizePersian } from '@/lib/policy/normalize';
import { repairPersianText, looksCorrupted, type PersianRepairReport } from '@/lib/policy/persian-repair';
import {
  chunkPolicyText,
  markCandidates,
  dedupeProposals,
  flagConflicts,
  candidateKeywords,
  type SourcePage,
  type RuleProposal,
} from '@/lib/policy/ingestion';
import { getPolicyLlm } from '@/lib/policy/local-llm-adapter';
import { ingestDocumentConcepts } from '@/lib/policy/ingestion/concept-ingestion-orchestrator';
import type { RuleSeverity } from '@prisma/client';
import crypto from 'crypto';

// ─── PDF Text Extraction ───────────────────────────────────────────────────

/** Page-aware extraction — keeps provenance (1-based page number per text). */
export async function extractPdfPages(filePath: string): Promise<SourcePage[]> {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const dataBuffer = fs.readFileSync(filePath);
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;

    const pages: SourcePage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const items = textContent.items as Array<{ str?: string }>;
      const pageText = items
        .map((item) => item.str ?? '')
        .join(' ')
        .trim();
      pages.push({ page: i, text: pageText });
    }

    const total = pages.reduce((acc, p) => acc + p.text.length, 0);
    if (total < 10) {
      throw new Error('متن قابل استخراج نیست؛ قواعد را دستی وارد کنید');
    }
    return pages;
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

/** Legacy full-text extraction (kept for backward compatibility). */
export async function extractTextFromPDF(filePath: string): Promise<string> {
  const pages = await extractPdfPages(filePath);
  return pages
    .map((p) => p.text)
    .join('\n')
    .trim();
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

// ─── Structured rule extraction (قاعده XXX-NNN headers) ────────────────────

/** Code-prefix → Persian category (SEPEHR-style policy docs). */
const RULE_CODE_CATEGORY: Record<string, string> = {
  SEC: 'امنیت',
  PII: 'داده‌های شخصی',
  FIN: 'اطلاعات مالی',
  HR: 'منابع انسانی',
  MED: 'سلامت',
  PRJ: 'محرمانگی',
  BIZ: 'اطلاعات مالی',
  DOC: 'محرمانگی',
};

const RULE_HEADER_RE = /(?:^|\s)قاعده\s+([A-Za-z]{2,8})[-–—]?\s?(\d{1,4})\s*[ـ–—-]*\s*([^\n]{2,100})/g;
const SECTION_HEADER_RE = /(?:^|\s)(?:[۰-۹0-9]{1,2})\s*[.)–]\s*[^\n]{2,80}/g;

export interface StructuredRuleDraft {
  /** Policy-native code, e.g. SEC-001 (display-only; DB code stays R-###). */
  policyCode: string;
  title: string;
  body: string;
  page: number | null;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: string;
  keywords: string[];
  detectorType: 'SEMANTIC';
  action: 'BLOCK_EXTERNAL';
  sourceQuote: string;
  textHash: string;
}

/**
 * Header-aware rule extraction for structured Persian policy documents:
 * segments the text at «قاعده XXX-NNN ـ عنوان» boundaries so each policy rule
 * becomes ONE rule with its exact body (instead of chunk-window noise).
 * Returns [] when fewer than 2 headers are found (unstructured doc → fallback).
 */
export function extractStructuredRules(pages: SourcePage[]): StructuredRuleDraft[] {
  // Join pages with offset tracking for page attribution.
  const spans: Array<{ page: number | null; start: number; end: number }> = [];
  const chunks: string[] = [];
  let cursor = 0;
  for (const p of pages) {
    const text = p.text.trim();
    if (!text) continue;
    chunks.push(text);
    spans.push({ page: p.page, start: cursor, end: cursor + text.length });
    cursor += text.length + 1;
  }
  const text = chunks.join('\n');
  if (!text) return [];

  const headers = [...text.matchAll(RULE_HEADER_RE)];
  if (headers.length < 2) return [];

  // Collect all boundary positions: rule headers + numbered section headers.
  // NOTE: the header regex consumes the whitespace BEFORE «قاعده» — strip it
  // so the boundary lands exactly at the header (correct page attribution).
  const boundaryStart = (m: RegExpMatchArray): number => {
    const lead = m[0].length - m[0].trimStart().length;
    return (m.index ?? 0) + lead;
  };
  const boundaries: Array<{ start: number; kind: 'rule' | 'section'; match: RegExpMatchArray }> = [];
  for (const m of headers) {
    boundaries.push({ start: boundaryStart(m), kind: 'rule', match: m });
  }
  for (const m of text.matchAll(SECTION_HEADER_RE)) {
    const idx = boundaryStart(m);
    const isRule = boundaries.some((b) => Math.abs(b.start - idx) < 3);
    if (!isRule) boundaries.push({ start: idx, kind: 'section', match: m });
  }
  boundaries.sort((a, b) => a.start - b.start);

  const pageFor = (offset: number): number | null => {
    // Last page whose span started at/before the offset (handles the
    // +1 joining-newline boundary overlap correctly).
    let result: number | null = null;
    for (const sp of spans) {
      if (offset >= sp.start) result = sp.page;
      else break;
    }
    return result;
  };

  const drafts: StructuredRuleDraft[] = [];
  const seenCodes = new Set<string>();

  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    if (b.kind !== 'rule') continue;
    const prefix = b.match[1].toUpperCase();
    const num = b.match[2];
    const policyCode = `${prefix}-${num}`;
    if (seenCodes.has(policyCode)) continue; // duplicated header (overlap)
    seenCodes.add(policyCode);

    const headerText = `${b.match[0].trim()} ${b.match[3].trim()}`.replace(/\s+/g, ' ').trim();
    const title = `قاعده ${policyCode} ـ ${b.match[3].trim()}`.replace(/\s+/g, ' ').slice(0, 120);

    const bodyStart = b.start + b.match[0].length;
    const next = boundaries[i + 1];
    const bodyEnd = next ? next.start : text.length;
    let body = text.slice(bodyStart, bodyEnd).replace(/\s+/g, ' ').trim();
    if (body.length > 1200) body = body.slice(0, 1200).trim();
    if (body.length < 20) continue; // header without real content → skip

    // Decision detection (§۵ tafavvom): BLOCKED is stricter than LOCAL_ONLY.
    const hasBlocked = /BLOCKED/.test(body);
    const hasLocalOnly = /LOCAL[-_ ]?ONLY|فقط\s+محلی/.test(body);
    if (!hasBlocked && !hasLocalOnly) continue; // ALLOW-style section → not a protective rule

    const severity: RuleSeverity = hasBlocked ? 'CRITICAL' : 'HIGH';
    const category = RULE_CODE_CATEGORY[prefix] ?? 'امنیت';

    const normBody = normalizePersian(body);
    const textHash = crypto
      .createHash('sha256')
      .update(`${policyCode}§${normBody}`)
      .digest('hex');

    drafts.push({
      policyCode,
      title,
      body,
      page: pageFor(b.start),
      severity,
      category,
      keywords: extractKeywords(body),
      detectorType: 'SEMANTIC',
      action: 'BLOCK_EXTERNAL',
      sourceQuote: headerText.slice(0, 240),
      textHash,
    });
  }

  return drafts;
}

/**
 * Process an uploaded policy document (PDF or TXT/MD):
 *   page-aware extraction → 800–1200 chunking with overlap + provenance →
 *   deterministic filters (boilerplate drop, candidate marking) →
 *   deterministic rule extraction (existing regex/keyword logic) →
 *   optional Local-LLM rule proposal (Zod-validated; PENDING_LLM on
 *   unavailability; NEVER an external provider) → dedupe/conflict flags →
 *   audit logging. Upload itself NEVER crashes on LLM unavailability.
 */
export async function processPolicyDocument(
  documentId: string,
  organizationId: string,
  sourceType: 'PDF' | 'TXT' | 'MD' = 'PDF',
  rawTextOverride?: string,
): Promise<void> {
  try {
    await updatePolicyDocumentStatus(documentId, 'PROCESSING');

    const doc = await getPolicyDocumentById(documentId, organizationId);
    if (!doc) {
      await updatePolicyDocumentStatus(documentId, 'FAILED', 'سند یافت نشد');
      return;
    }

    // ── 1. Text extraction (page-aware for PDF, single page for TXT/MD) ──
    let pages: SourcePage[];
    if (sourceType === 'PDF') {
      const filePath = path.join(UPLOADS_DIR, `${documentId}.pdf`);
      pages = await extractPdfPages(filePath);
    } else {
      let rawText = rawTextOverride;
      if (rawText === undefined && doc.storagePath && fs.existsSync(doc.storagePath)) {
        rawText = fs.readFileSync(doc.storagePath, 'utf8'); // reprocess path
      }
      if (rawText === undefined) {
        throw new Error('متن سند متنی ارائه نشده است');
      }
      pages = [{ page: null, text: rawText }];
    }

    // ── 1b. Deterministic Persian text repair (ligature-reversal fix) ─────
    // Fixes PDF text-layer damage: اطالعات→اطلاعات، کنرتل→کنترل، منت→متن…
    let repairTotals: PersianRepairReport = {
      swappedTokens: 0,
      replacements: [],
      gluedPunctuation: 0,
      junkRemoved: 0,
      collapsedRepeats: 0,
    };
    const repairedPages: SourcePage[] = pages.map((p) => {
      if (!looksCorrupted(p.text)) return p; // clean page → untouched
      const { text: repaired, report } = repairPersianText(p.text);
      repairTotals = {
        swappedTokens: repairTotals.swappedTokens + report.swappedTokens,
        replacements: [...repairTotals.replacements, ...report.replacements].slice(0, 40),
        gluedPunctuation: repairTotals.gluedPunctuation + report.gluedPunctuation,
        junkRemoved: repairTotals.junkRemoved + report.junkRemoved,
        collapsedRepeats: repairTotals.collapsedRepeats + report.collapsedRepeats,
      };
      return { page: p.page, text: repaired };
    });

    if (repairTotals.swappedTokens > 0 || repairTotals.gluedPunctuation > 0) {
      await createPolicyAuditLog({
        organizationId,
        actorId: doc.uploadedById,
        action: 'TEXT_REPAIR',
        targetType: 'POLICY_DOCUMENT',
        targetId: documentId,
        metadata: {
          pagesRepaired: repairedPages.length,
          swappedTokens: repairTotals.swappedTokens,
          gluedPunctuation: repairTotals.gluedPunctuation,
          junkRemoved: repairTotals.junkRemoved,
          collapsedRepeats: repairTotals.collapsedRepeats,
          replacements: repairTotals.replacements.slice(0, 20),
        },
      });
    }

    const rawText = repairedPages.map((p) => p.text).join('\n').trim();
    const normalizedText = normalizePersian(rawText);

    await createPolicyAuditLog({
      organizationId,
      actorId: doc.uploadedById,
      action: 'CHUNKING',
      targetType: 'POLICY_DOCUMENT',
      targetId: documentId,
      metadata: {
        sourceType,
        pages: pages.length,
        extractedChars: rawText.length,
      },
    });

    // ── 2. Chunking: 800–1200 chars, 15–20% overlap, stable hashes ───────
    const drafts = markCandidates(chunkPolicyText(repairedPages));

    // Map drafts to DB chunks. isRestricted keeps feeding the legacy BM25
    // snapshot; isCandidate marks the new-rule extraction scope.
    const dbChunks = drafts.map((d) => ({
      documentId,
      index: d.ordinal,
      content: d.text,
      normalizedContent: normalizePersian(d.text),
      isRestricted: RESTRICTED_KEYWORDS.some((kw) => d.text.includes(kw)),
      pageIndex: d.pageIndex,
      textHash: d.textHash,
      spanStart: d.spanStart,
      spanEnd: d.spanEnd,
      isCandidate: d.isCandidate,
    }));
    if (dbChunks.length > 0) {
      await createPolicyChunks(dbChunks);
    }
    // Ordinal → DB chunk id (provenance link for LLM-proposed rules).
    const chunkDbIds = new Map<number, string>(
      (await getPolicyChunks(documentId)).map((c) => [c.index, c.id]),
    );

    // ── 3. Deterministic rule extraction ─────────────────────────────────
    // Structured path first: «قاعده XXX-NNN» headers give one clean rule per
    // policy rule. Fallback: legacy chunk-window extraction for unstructured docs.
    const structuredRules = extractStructuredRules(repairedPages);
    const useStructured = structuredRules.length >= 2;
    const extractedRules = useStructured
      ? []
      : extractRulesFromChunks(
          drafts
            .filter((d) => !d.isBoilerplate)
            .map((d, i) => ({ content: d.text, index: i })),
        );

    // Rule codes continue after the org's highest R-### (org-wide unique).
    let nextCodeNumber = (await getMaxRuleCodeNumber(organizationId)) + 1;
    const allocCode = (): string => `R-${String(nextCodeNumber).padStart(3, '0')}`;

    const saveRuleWithRetry = async (
      data: Omit<Parameters<typeof createPolicyRule>[0], 'code'>,
    ) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          await createPolicyRule({ ...data, code: allocCode() });
          nextCodeNumber++;
          return true;
        } catch (err) {
          if (!isUniqueConstraintViolation(err)) throw err;
          nextCodeNumber++;
        }
      }
      return false;
    };

    // ── 4. Save deterministic rules (status ACTIVE — existing semantics) ─
    if (useStructured) {
      // Org-wide dedupe by stable textHash: re-uploading the same policy
      // (or reprocessing) must not duplicate rules.
      let duplicatedStructured = 0;
      for (const rule of structuredRules) {
        const existing = await findRuleByTextHash(organizationId, rule.textHash);
        if (existing) {
          duplicatedStructured++;
          continue;
        }
        const saved = await saveRuleWithRetry({
          documentId,
          organizationId,
          title: rule.title,
          body: rule.body,
          keywords: rule.keywords,
          patterns: [],
          severity: rule.severity as RuleSeverity,
          category: rule.category,
          isManual: false,
          detectorType: 'SEMANTIC',
          action: 'BLOCK_EXTERNAL',
          status: 'ACTIVE',
          sourceQuote: rule.sourceQuote,
          sourcePage: rule.page,
          textHash: rule.textHash,
        });
        if (!saved) {
          throw new Error('خطا در ذخیره قاعده: کد یکتا برای قاعده قابل تخصیص نیست');
        }
      }
      await createPolicyAuditLog({
        organizationId,
        actorId: doc.uploadedById,
        action: 'RULE_EXTRACT',
        targetType: 'POLICY_DOCUMENT',
        targetId: documentId,
        metadata: {
          mode: 'structured_headers',
          rules: structuredRules.length,
          duplicated: duplicatedStructured,
          codes: structuredRules.map((r) => r.policyCode),
        },
      });
    } else {
      for (const rule of extractedRules) {
        const saved = await saveRuleWithRetry({
          documentId,
          organizationId,
          title: rule.title,
          body: rule.body,
          keywords: rule.keywords,
          patterns: [],
          severity: rule.severity as RuleSeverity,
          category: rule.category,
          isManual: false,
          detectorType: 'SEMANTIC',
          action: 'BLOCK_EXTERNAL',
          status: 'ACTIVE',
        });
        if (!saved) {
          throw new Error('خطا در ذخیره قاعده: کد یکتا برای قاعده قابل تخصیص نیست');
        }
      }
    }

    // ── 5. Local-LLM rule proposal (pluggable; NEVER external) ───────────
    const candidateDrafts = drafts.filter((d) => d.isCandidate && !d.isBoilerplate);
    const policyLlm = getPolicyLlm();
    const availability = await policyLlm.availability();

    let proposedCount = 0;
    let rejectedCount = 0;
    let pendingLlmCount = 0;
    let duplicateCount = 0;
    let conflictCount = 0;

    if (!availability.available) {
      // Layer disabled or unreachable → deterministic-only. Nothing crashes;
      // candidate chunks remain available for manual rule definition.
      await createPolicyAuditLog({
        organizationId,
        actorId: doc.uploadedById,
        action: 'RULE_PROPOSE',
        targetType: 'POLICY_DOCUMENT',
        targetId: documentId,
        metadata: {
          localLlm: availability.reason,
          candidateChunks: candidateDrafts.length,
          deterministicRules: extractedRules.length,
        },
      });
    } else {
      const proposals: RuleProposal[] = [];

      for (const d of candidateDrafts) {
        const result = await policyLlm.extractRules({
          chunkId: `doc_${documentId}_chunk_${String(d.ordinal).padStart(3, '0')}`,
          page: d.pageIndex,
          text: d.text,
          languageHint: 'fa',
          knownKeywords: candidateKeywords().slice(0, 10),
        });

        if (result.rules.length === 0 && result.rejected.length === 0) {
          // LLM produced nothing usable → rule stays PENDING_LLM (stub) so an
          // admin can define it manually later.
          pendingLlmCount++;
          continue;
        }

        for (let ri = 0; ri < result.rules.length; ri++) {
          const r = result.rules[ri];
          // v2: prefer the per-rule verbatim quote sliced from the chunk via
          // the LLM's anchor; fall back to the chunk prefix.
          const perRuleQuote = result.ruleQuotes?.[ri] ?? '';
          proposals.push({
            chunkOrdinal: d.ordinal,
            pageIndex: d.pageIndex,
            sourceQuote: perRuleQuote || result.sourceQuote || d.text.slice(0, 120),
            proposed: r,
          });
        }
        rejectedCount += result.rejected.length;
      }

      // ── 6. Dedupe + conflict flags ─────────────────────────────────────
      const verdicts = dedupeProposals(proposals);
      const accepted = verdicts
        .filter((v) => v.verdict.kind === 'ACCEPT')
        .map((v) => ({ proposal: v.proposal, identityHash: v.identityHash }));
      const conflictGroups = flagConflicts(accepted);
      // Indexes in flagConflicts refer to the accepted[] array order.
      let acceptedIndex = -1;

      for (const v of verdicts) {
        if (v.verdict.kind === 'DUPLICATE') {
          duplicateCount++;
          continue; // flagged duplicates are not persisted as new rules
        }
        acceptedIndex++;
        const group = conflictGroups.get(String(acceptedIndex)) ?? null;
        if (group) conflictCount++;

        const p = v.proposal;
        await saveRuleWithRetry({
          documentId,
          organizationId,
          title: p.proposed.label.slice(0, 120),
          body: p.sourceQuote,
          keywords: p.proposed.keywordsHint ?? [],
          patterns:
            p.proposed.detectorType === 'REGEX' && p.proposed.regex
              ? [p.proposed.regex.source]
              : [],
          severity: p.proposed.confidence >= 0.9 ? 'CRITICAL' : 'HIGH',
          category: p.proposed.category,
          isManual: false,
          status: 'DRAFT',
          detectorType: p.proposed.detectorType,
          checksumKind: p.proposed.checksumKind,
          action: p.proposed.action,
          priority: p.proposed.priority,
          sourceQuote: p.sourceQuote,
          sourcePage: p.pageIndex ?? undefined,
          textHash: v.identityHash,
          conflictGroup: group ?? undefined,
          chunkId: chunkDbIds.get(p.chunkOrdinal),
        });
        proposedCount++;
      }

      await createPolicyAuditLog({
        organizationId,
        actorId: doc.uploadedById,
        action: 'RULE_PROPOSE',
        targetType: 'POLICY_DOCUMENT',
        targetId: documentId,
        metadata: {
          localLlm: availability.model,
          candidateChunks: candidateDrafts.length,
          deterministicRules: extractedRules.length,
          proposedRules: proposedCount,
          rejectedRules: rejectedCount,
          duplicates: duplicateCount,
          conflicts: conflictCount,
        },
      });
    }

    // ── Phase 2: Ingest structured PolicyUnits & PolicyConcepts ────────
    if (process.env.POLICY_INGESTION_MODE !== 'legacy') {
      try {
        const filePath =
          sourceType === 'PDF'
            ? path.join(UPLOADS_DIR, `${documentId}.pdf`)
            : doc.storagePath;
        if (filePath && fs.existsSync(filePath)) {
          await ingestDocumentConcepts(filePath, documentId, organizationId, {
            sourceType,
          });
        }
      } catch (conceptErr) {
        console.error('[pdf-processor] Phase 2 concept ingestion non-fatal error:', conceptErr);
      }
    }

    // ── 7. Document READY (lifecycle stays DRAFT until admin review) ─────
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
    console.error('[pdf-processor] processing failed:', errorMessage);
    await updatePolicyDocumentStatus(documentId, 'FAILED', errorMessage).catch(() => {
      // If status update fails, we can't do much
    });
  }
}
