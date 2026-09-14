// Structural Policy Document Segmenter
// (MIGRATION_PLAN_REVIEWED_v1.1 §2.2, spec §10, §11, §42)

import { normalizePersian } from '../normalize';
import type { PolicyUnitType } from '../concepts/types';
import type { ExtractedPage } from './pdf-extractor';

export interface SegmentedUnit {
  ordinal: number;
  page: number | null;
  sectionTitle: string | null;
  text: string;
  normalizedText: string;
  unitType: PolicyUnitType;
  spanStart: number;
  spanEnd: number;
  isCandidate: boolean;
}

export interface SegmenterOptions {
  maxUnitLength?: number; // Target max chars for large units (split strictly on sentences)
  candidateKeywords?: string[];
}

export const DEFAULT_CANDIDATE_KEYWORDS = [
  'ممنوع',
  'محرمانه',
  'نباید',
  'مجاز نیست',
  'طبقه‌بندی',
  'طبقه بندی',
  'سرّی',
  'سری',
  'حفاظت',
  'حریم خصوصی',
  'افشا',
  'افشای',
  'مسدود',
  'رمز',
  'رمز عبور',
  'کلید خصوصی',
  'توکن',
  'کد ملی',
  'کدملی',
  'شماره کارت',
  'شبا',
  'حساب بانکی',
  'اطلاعات تماس',
  'تلفن همراه',
  'موبایل',
  'ip داخلی',
  'نشانی سرور',
];

const HEADING_PATTERNS = [
  /^(فصل|بخش|پیوست|قسمت)\s+[۰-۹0-9IVXLCDMivxlcdm\u06F0-\u06F9]+(\s*[:ـ\-–—\.]|\s+)/,
  /^[۰-۹0-9\u06F0-\u06F9]+[\-\.\)]\s+/,
];

const BULLET_PATTERNS = [
  /^[\s]*[•\*\-–—]\s+/,
  /^[\s]*[۰-۹0-9\u06F0-\u06F9]+[\-\.\)]\s+/,
  /^[\s]*[الف-یabc]\)\s+/i,
];

const CLAUSE_PATTERNS = [
  /^(ماده|بند|تبصره|قاعده|اصل)\s+[۰-۹0-9\u06F0-\u06F9A-Za-z_-]+[:ـ\-–—\.]?/,
];

/**
 * Checks if a block of text contains policy candidate keywords (spec §42).
 */
export function isCandidateUnit(text: string, keywords: string[] = DEFAULT_CANDIDATE_KEYWORDS): boolean {
  const norm = normalizePersian(text).toLowerCase();
  for (const kw of keywords) {
    if (norm.includes(normalizePersian(kw).toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * Splits a text into Persian sentences preserving punctuation.
 * Never breaks a sentence in the middle.
 */
export function splitSentences(text: string): string[] {
  // Split on Persian / Arabic / Latin sentence enders: . ! ؟ ؛ \n
  const sentences = text
    .split(/(?<=[\.!\u061F\u061B\?\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  return sentences.length > 0 ? sentences : [text.trim()];
}

/**
 * Determines whether a single line is a section heading.
 */
function isHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (isClauseStart(trimmed)) return false;
  if (isBulletLine(trimmed)) return false;
  if (isTableLine(trimmed)) return false;

  // Pattern matches
  for (const pattern of HEADING_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  // Short line with no sentence terminal punctuation
  if (trimmed.length <= 60 && !/[\.!؟\?؛]$/.test(trimmed)) {
    // If it has multiple words (2 to 10 words)
    const words = trimmed.split(/\s+/);
    if (words.length >= 2 && words.length <= 10) {
      return true;
    }
  }

  return false;
}

function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && (trimmed.startsWith('|') || trimmed.endsWith('|'));
}

function isBulletLine(line: string): boolean {
  return BULLET_PATTERNS.some((p) => p.test(line.trim()));
}

function isClauseStart(line: string): boolean {
  return CLAUSE_PATTERNS.some((p) => p.test(line.trim()));
}

/**
 * Main segmenter: splits document pages into structured PolicyUnits.
 * Preserves sentence integrity (spec §10) and marks candidates (spec §42).
 */
export function segmentDocument(
  pages: ExtractedPage[],
  options: SegmenterOptions = {},
): SegmentedUnit[] {
  const maxLen = options.maxUnitLength ?? 1200;
  const keywords = options.candidateKeywords ?? DEFAULT_CANDIDATE_KEYWORDS;

  const units: SegmentedUnit[] = [];
  let ordinal = 0;
  let currentSectionTitle: string | null = null;
  let globalCharOffset = 0;

  for (const page of pages) {
    const rawLines = page.text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    let lineIdx = 0;

    while (lineIdx < rawLines.length) {
      const line = rawLines[lineIdx];

      // 1. HEADING
      if (isHeadingLine(line)) {
        currentSectionTitle = line;
        const norm = normalizePersian(line);
        units.push({
          ordinal: ordinal++,
          page: page.page,
          sectionTitle: currentSectionTitle,
          text: line,
          normalizedText: norm,
          unitType: 'HEADING',
          spanStart: globalCharOffset,
          spanEnd: globalCharOffset + line.length,
          isCandidate: isCandidateUnit(line, keywords),
        });
        globalCharOffset += line.length + 1;
        lineIdx++;
        continue;
      }

      // 2. TABLE (group consecutive table rows)
      if (isTableLine(line)) {
        const tableLines: string[] = [];
        while (lineIdx < rawLines.length && isTableLine(rawLines[lineIdx])) {
          tableLines.push(rawLines[lineIdx]);
          lineIdx++;
        }
        const tableText = tableLines.join('\n');
        const norm = normalizePersian(tableText);
        units.push({
          ordinal: ordinal++,
          page: page.page,
          sectionTitle: currentSectionTitle,
          text: tableText,
          normalizedText: norm,
          unitType: 'TABLE',
          spanStart: globalCharOffset,
          spanEnd: globalCharOffset + tableText.length,
          isCandidate: isCandidateUnit(tableText, keywords),
        });
        globalCharOffset += tableText.length + 1;
        continue;
      }

      // 3. BULLET GROUP (group consecutive bullet items)
      if (isBulletLine(line)) {
        const bulletLines: string[] = [];
        while (lineIdx < rawLines.length && isBulletLine(rawLines[lineIdx])) {
          bulletLines.push(rawLines[lineIdx]);
          lineIdx++;
        }
        const bulletText = bulletLines.join('\n');
        const norm = normalizePersian(bulletText);
        units.push({
          ordinal: ordinal++,
          page: page.page,
          sectionTitle: currentSectionTitle,
          text: bulletText,
          normalizedText: norm,
          unitType: 'BULLET_GROUP',
          spanStart: globalCharOffset,
          spanEnd: globalCharOffset + bulletText.length,
          isCandidate: isCandidateUnit(bulletText, keywords),
        });
        globalCharOffset += bulletText.length + 1;
        continue;
      }

      // 4. CLAUSE or PARAGRAPH
      const isClause = isClauseStart(line);
      const paraLines: string[] = [];

      while (
        lineIdx < rawLines.length &&
        !isHeadingLine(rawLines[lineIdx]) &&
        !isTableLine(rawLines[lineIdx]) &&
        !isBulletLine(rawLines[lineIdx])
      ) {
        paraLines.push(rawLines[lineIdx]);
        lineIdx++;
        // If a new clause starts inside, break to treat as distinct clause unit
        if (lineIdx < rawLines.length && isClauseStart(rawLines[lineIdx])) {
          break;
        }
      }

      const paraText = paraLines.join(' ');
      if (!paraText.trim()) continue;

      // Check if paragraph is within maxLen; if not, partition on sentence boundaries
      if (paraText.length <= maxLen) {
        const norm = normalizePersian(paraText);
        units.push({
          ordinal: ordinal++,
          page: page.page,
          sectionTitle: currentSectionTitle,
          text: paraText,
          normalizedText: norm,
          unitType: isClause ? 'CLAUSE' : 'PARAGRAPH',
          spanStart: globalCharOffset,
          spanEnd: globalCharOffset + paraText.length,
          isCandidate: isCandidateUnit(paraText, keywords),
        });
        globalCharOffset += paraText.length + 1;
      } else {
        // Large unit — partition strictly on sentence boundaries (spec §10)
        const sentences = splitSentences(paraText);
        let buffer: string[] = [];
        let bufferLen = 0;

        for (const sent of sentences) {
          if (bufferLen + sent.length > maxLen && buffer.length > 0) {
            const chunkText = buffer.join(' ');
            const norm = normalizePersian(chunkText);
            units.push({
              ordinal: ordinal++,
              page: page.page,
              sectionTitle: currentSectionTitle,
              text: chunkText,
              normalizedText: norm,
              unitType: isClause ? 'CLAUSE' : 'PARAGRAPH',
              spanStart: globalCharOffset,
              spanEnd: globalCharOffset + chunkText.length,
              isCandidate: isCandidateUnit(chunkText, keywords),
            });
            globalCharOffset += chunkText.length + 1;
            buffer = [];
            bufferLen = 0;
          }
          buffer.push(sent);
          bufferLen += sent.length + 1;
        }

        if (buffer.length > 0) {
          const chunkText = buffer.join(' ');
          const norm = normalizePersian(chunkText);
          units.push({
            ordinal: ordinal++,
            page: page.page,
            sectionTitle: currentSectionTitle,
            text: chunkText,
            normalizedText: norm,
            unitType: isClause ? 'CLAUSE' : 'PARAGRAPH',
            spanStart: globalCharOffset,
            spanEnd: globalCharOffset + chunkText.length,
            isCandidate: isCandidateUnit(chunkText, keywords),
          });
          globalCharOffset += chunkText.length + 1;
        }
      }
    }
  }

  return units;
}
