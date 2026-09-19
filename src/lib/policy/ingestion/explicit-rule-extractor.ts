import { ExtractedConceptSchema, type ExtractedConcept } from '../concepts/validator';

/** Lossless extraction for explicit numbered clauses. Never guess a missing action. */
export function extractExplicitRule(text: string, page?: number | null): ExtractedConcept[] | null {
  const header = text.match(/^\s*(?:قاعده|Rule)\s+([A-Z]+-\d+)\s*[ـ:–—-]?\s*([^\n]*)/i);
  if (!header) return null;
  const body = text.slice(header[0].length).trim();
  const actionTokens = [...body.matchAll(/\b(LOCAL_ONLY|ROUTE_LOCAL|ALLOW_EXTERNAL|BLOCKED|BLOCK|MASK_AND_ALLOW_EXTERNAL)\b/g)].map(m => m[1]);
  const actions = new Set(actionTokens.map(a => a === 'LOCAL_ONLY' ? 'ROUTE_LOCAL' : a === 'BLOCKED' ? 'BLOCK' : a));
  if (actions.size !== 1) return null;
  const action = [...actions][0];
  const sentences = body.split(/(?<=[.!؟])\s+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const conditions = sentences.filter(s => /نیست|نمی|مشمول|به تنهایی|به‌تنهایی|مانند|except|placeholder/i.test(s));
  return [ExtractedConceptSchema.parse({
    conceptKey: header[1].toLowerCase().replace(/-/g, '_'),
    name: header[1], nameFa: header[2].trim() || header[1],
    descriptionFa: body, category: header[2].trim(),
    sensitivity: action === 'ALLOW_EXTERNAL' ? 'PUBLIC' : 'CONFIDENTIAL', action,
    positiveExamples: [], negativeExamples: [], conditions,
    keywords: [header[1], header[2].trim()],
    sourceQuote: text.trim(), sourcePage: page ?? null, confidence: 1,
  })];
}

/** Definitions and document scope must not become standalone content restrictions. */
export function isPolicyMetadata(text: string, sectionTitle?: string | null): boolean {
  if (/^\s*(?:قاعده|Rule)\s+/i.test(text)) return false;
  return /هدف و دامنه|تصمیم.?های مجاز/.test(sectionTitle ?? '') ||
    /^(?:ALLOW_EXTERNAL|LOCAL_ONLY|BLOCKED)\s*:/i.test(text.trim()) ||
    /^سیاست حفاظت از داده و استفاده از سرویس/.test(text.trim());
}
