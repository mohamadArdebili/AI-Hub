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

export const SKELETON_METADATA_PATTERNS = [
  /^:?\s*(Sensitivity|Action|Status|Version|Policy\s*ID)\b/i,
  /^(Positive\s*Examples|Negative\s*Examples|Positive\s*\/\s*Allowed\s*Examples|Allowed\s*Examples|Positive\s*\/\s*Forbidden\s*Examples)/i,
  /^:?\s*(ALLOW_EXTERNAL|ROUTE_LOCAL|MASK_AND_ALLOW_EXTERNAL|BLOCK|EXTERNAL_DIRECT|EXTERNAL_MASKED|LOCAL|BLOCKED)\b/i,
];

export function isSkeletonOrMetadataLine(line: string): boolean {
  const trimmed = line.trim();
  return SKELETON_METADATA_PATTERNS.some((p) => p.test(trimmed));
}

const HEADING_PATTERNS = [
  /^(فصل|بخش|پیوست|قسمت)\s+[۰-۹0-9IVXLCDMivxlcdm\u06F0-\u06F9]+(\s*[:ـ\-–—\.]|\s+)/,
  /^[.\-–—]?[۰-۹0-9\u06F0-\u06F9]+[\-\.\)]?\s+/,
];

export function isNumberedSectionHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return false;
  if (isSkeletonOrMetadataLine(trimmed)) return false;
  if (/[\.!؟\?؛]$/.test(trimmed)) return false;
  if (trimmed.endsWith(':')) return false;
  return HEADING_PATTERNS.some((p) => p.test(trimmed));
}

const BULLET_PATTERNS = [
  /^[\s]*[•\*\-–—]\s+/,
  /^[\s]*[۰-۹0-9\u06F0-\u06F9]+[\-\.\)]\s+/,
  /^[\s]*[الف-یabc]\)\s+/i,
];

const CLAUSE_PATTERNS = [
  /^(ماده|بند|تبصره|قاعده|اصل|تعریف|نکته)\s+[۰-۹0-9\u06F0-\u06F9A-Za-z_-]*[:ـ\-–—\.]?/,
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
export function isHeadingLine(line: string, nextLine?: string | null): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (isSkeletonOrMetadataLine(trimmed)) return false;
  if (isTableLine(trimmed)) return false;

  // If followed immediately by metadata line like ':Action ...', this is a level/rule title, not a document section heading
  if (nextLine && isSkeletonOrMetadataLine(nextLine) && !isNumberedSectionHeading(trimmed)) {
    return false;
  }

  if (isNumberedSectionHeading(trimmed)) {
    return true;
  }

  if (isClauseStart(trimmed)) return false;
  if (isBulletLine(trimmed)) return false;

  // Short line with no sentence terminal punctuation
  if (trimmed.length <= 60 && !/[\.!؟\?؛]$/.test(trimmed) && !trimmed.endsWith(':') && !trimmed.startsWith(':')) {
    const words = trimmed.split(/\s+/);
    if (words.length >= 2 && words.length <= 8) {
      return true;
    }
  }

  return false;
}

export function isTableLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    (trimmed.includes('|') && (trimmed.startsWith('|') || trimmed.endsWith('|'))) ||
    /^ID\s+سناریو\b/i.test(trimmed) ||
    /^T\d+\s+/i.test(trimmed)
  );
}

export function isBulletLine(line: string): boolean {
  return BULLET_PATTERNS.some((p) => p.test(line.trim()));
}

export function isClauseStart(line: string): boolean {
  return CLAUSE_PATTERNS.some((p) => p.test(line.trim()));
}

export function isExampleMarkerLine(line: string): boolean {
  const trimmed = line.trim();
  return /^(Positive\s*Examples|Negative\s*Examples|Positive\s*\/\s*Allowed\s*Examples|Allowed\s*Examples|Positive\s*\/\s*Forbidden\s*Examples)/i.test(trimmed);
}

export function isLevelClauseStart(line: string, nextLine?: string | null): boolean {
  const trimmed = line.trim();
  if (/^سطح\s+/i.test(trimmed)) return true;
  if (nextLine && isSkeletonOrMetadataLine(nextLine) && !isNumberedSectionHeading(trimmed)) {
    return true;
  }
  return false;
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
    let pendingMetadata: string[] = [];

    while (lineIdx < rawLines.length) {
      const line = rawLines[lineIdx];
      const nextLine = lineIdx + 1 < rawLines.length ? rawLines[lineIdx + 1] : null;

      // 1. HEADING
      if (isHeadingLine(line, nextLine)) {
        currentSectionTitle = line;
        pendingMetadata = [];
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

      // Standalone skeleton metadata line (e.g. :Sensitivity ..., :Action ...)
      if (isSkeletonOrMetadataLine(line) && !isExampleMarkerLine(line)) {
        pendingMetadata.push(line);
        lineIdx++;
        continue;
      }

      // 2. TABLE (group consecutive table rows)
      if (isTableLine(line)) {
        const tableLines: string[] = [...pendingMetadata];
        pendingMetadata = [];
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

      // 3. LEVEL CLAUSE (e.g. 'سطح عمومی' + ':Action ALLOW_EXTERNAL' + description)
      if (isLevelClauseStart(line, nextLine)) {
        const clauseLines: string[] = [...pendingMetadata, line];
        pendingMetadata = [];
        lineIdx++;
        while (
          lineIdx < rawLines.length &&
          !isHeadingLine(rawLines[lineIdx], lineIdx + 1 < rawLines.length ? rawLines[lineIdx + 1] : null) &&
          !isTableLine(rawLines[lineIdx]) &&
          !isBulletLine(rawLines[lineIdx]) &&
          !isLevelClauseStart(rawLines[lineIdx], lineIdx + 1 < rawLines.length ? rawLines[lineIdx + 1] : null)
        ) {
          clauseLines.push(rawLines[lineIdx]);
          lineIdx++;
          if (/[\.!؟\?]$/.test(clauseLines[clauseLines.length - 1])) {
            break;
          }
        }
        const clauseText = clauseLines.join('\n');
        const norm = normalizePersian(clauseText);
        units.push({
          ordinal: ordinal++,
          page: page.page,
          sectionTitle: currentSectionTitle,
          text: clauseText,
          normalizedText: norm,
          unitType: 'CLAUSE',
          spanStart: globalCharOffset,
          spanEnd: globalCharOffset + clauseText.length,
          isCandidate: isCandidateUnit(clauseText, keywords),
        });
        globalCharOffset += clauseText.length + 1;
        continue;
      }

      // 4. BULLET GROUP (optionally prefixed with example markers and pending metadata)
      const isExampleMarker = isExampleMarkerLine(line);
      if (isBulletLine(line) || isExampleMarker) {
        const bulletLines: string[] = [...pendingMetadata];
        pendingMetadata = [];
        if (isExampleMarker) {
          bulletLines.push(line);
          lineIdx++;
        }
        while (
          lineIdx < rawLines.length &&
          !isHeadingLine(rawLines[lineIdx], lineIdx + 1 < rawLines.length ? rawLines[lineIdx + 1] : null) &&
          !isTableLine(rawLines[lineIdx]) &&
          !isLevelClauseStart(rawLines[lineIdx], lineIdx + 1 < rawLines.length ? rawLines[lineIdx + 1] : null)
        ) {
          if (isExampleMarkerLine(rawLines[lineIdx]) && bulletLines.length > 0) {
            break;
          }
          const curr = rawLines[lineIdx];
          const isBullet = isBulletLine(curr);
          bulletLines.push(curr);
          lineIdx++;
          if (!isBullet && !isExampleMarker && curr.endsWith('.')) {
            break;
          }
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

      // 5. CLAUSE or PARAGRAPH
      const isClause = isClauseStart(line) || pendingMetadata.length > 0;
      const paraLines: string[] = [...pendingMetadata];
      pendingMetadata = [];

      while (
        lineIdx < rawLines.length &&
        !isHeadingLine(rawLines[lineIdx], lineIdx + 1 < rawLines.length ? rawLines[lineIdx + 1] : null) &&
        !isTableLine(rawLines[lineIdx]) &&
        !isBulletLine(rawLines[lineIdx]) &&
        !isExampleMarkerLine(rawLines[lineIdx]) &&
        !isLevelClauseStart(rawLines[lineIdx], lineIdx + 1 < rawLines.length ? rawLines[lineIdx + 1] : null)
      ) {
        paraLines.push(rawLines[lineIdx]);
        lineIdx++;
        if (lineIdx < rawLines.length && isClauseStart(rawLines[lineIdx])) {
          break;
        }
      }

      const paraText = paraLines.join('\n');
      if (!paraText.trim()) continue;

      const norm = normalizePersian(paraText);
      const isCandidate = isCandidateUnit(paraText, keywords);

      if (paraText.length <= maxLen) {
        units.push({
          ordinal: ordinal++,
          page: page.page,
          sectionTitle: currentSectionTitle,
          text: paraText,
          normalizedText: norm,
          unitType: isClause ? 'CLAUSE' : 'PARAGRAPH',
          spanStart: globalCharOffset,
          spanEnd: globalCharOffset + paraText.length,
          isCandidate,
        });
        globalCharOffset += paraText.length + 1;
      } else {
        const sentences = splitSentences(paraText);
        let buffer: string[] = [];
        let bufferLen = 0;

        for (const sent of sentences) {
          if (bufferLen + sent.length > maxLen && buffer.length > 0) {
            const chunkText = buffer.join(' ');
            const chunkNorm = normalizePersian(chunkText);
            units.push({
              ordinal: ordinal++,
              page: page.page,
              sectionTitle: currentSectionTitle,
              text: chunkText,
              normalizedText: chunkNorm,
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
          const chunkNorm = normalizePersian(chunkText);
          units.push({
            ordinal: ordinal++,
            page: page.page,
            sectionTitle: currentSectionTitle,
            text: chunkText,
            normalizedText: chunkNorm,
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
