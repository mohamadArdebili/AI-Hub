// PDF Extractor — Page-aware PDF and text document extraction
// (MIGRATION_PLAN_REVIEWED_v1.1 §2.1, spec §9, §71 Phase 2)

import fs from 'fs';
import { repairPersianText, looksCorrupted, type PersianRepairReport } from '../persian-repair';

export interface ExtractedPage {
  page: number; // 1-based
  text: string;
  rawText?: string;
  repaired?: boolean;
  repairReport?: PersianRepairReport;
}

export interface ExtractPdfOptions {
  repairPersian?: boolean;
}

/**
 * Page-aware extraction — preserves page numbers and text provenance.
 * Optionally applies Persian ligature reversal repair (repairPersianText).
 */
export async function extractPdfPages(
  filePath: string,
  options: ExtractPdfOptions = { repairPersian: true },
): Promise<ExtractedPage[]> {
  try {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const dataBuffer = fs.readFileSync(filePath);
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(dataBuffer) }).promise;

    const pages: ExtractedPage[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const items = textContent.items as Array<{ str?: string }>;
      const rawPageText = items
        .map((item) => item.str ?? '')
        .join(' ')
        .trim();

      let finalText = rawPageText;
      let repairReport: PersianRepairReport | undefined;

      if (options.repairPersian && looksCorrupted(rawPageText)) {
        const repairResult = repairPersianText(rawPageText);
        repairReport = repairResult.report;
        finalText = repairResult.text;
      }

      pages.push({
        page: i,
        text: finalText,
        rawText: rawPageText,
        repaired: repairReport ? repairReport.swappedTokens > 0 : false,
        repairReport,
      });
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
    console.error('[pdf-extractor] PDF extraction failed:', err);
    throw new Error('متن قابل استخراج نیست؛ قواعد را دستی وارد کنید');
  }
}

/**
 * Extracts plain text or markdown files into page-like structure (single page or delimited).
 */
export function extractTextDocument(
  filePath: string,
  options: ExtractPdfOptions = { repairPersian: true },
): ExtractedPage[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  let finalText = content;
  let repairReport: PersianRepairReport | undefined;

  if (options.repairPersian && looksCorrupted(content)) {
    const repairResult = repairPersianText(content);
    repairReport = repairResult.report;
    finalText = repairResult.text;
  }

  return [
    {
      page: 1,
      text: finalText,
      rawText: content,
      repaired: repairReport ? repairReport.swappedTokens > 0 : false,
      repairReport,
    },
  ];
}
