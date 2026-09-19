// Policy Concept Validator — Zod schema & Provenance Verification
// (MIGRATION_PLAN_REVIEWED_v1.1 §1.3, spec §12, §13, §43, Rule 10)

import { z } from 'zod';
import { normalizePersian } from '../normalize';

export const ConceptSensitivitySchema = z.enum([
  'PUBLIC',
  'INTERNAL',
  'CONFIDENTIAL',
  'HIGHLY_CONFIDENTIAL',
]);

export const ConceptActionSchema = z.enum([
  'ALLOW_EXTERNAL',
  'ROUTE_LOCAL',
  'MASK_AND_ALLOW_EXTERNAL',
  'BLOCK',
]);

export const ConceptReviewStatusSchema = z.enum([
  'DRAFT',
  'REVIEW',
  'ACTIVE',
  'ARCHIVED',
  'REJECTED',
]);

export const DetectorHintsSchema = z
  .object({
    regex: z.array(z.string()).optional(),
    checksum: z.array(z.string()).optional(),
    dictionary: z.array(z.string()).optional(),
    flags: z.array(z.string()).optional(),
  })
  .partial();

/**
 * Raw single concept extracted by LLM (spec §12/§43).
 * Mandatory: name, descriptionFa, sensitivity, action, positiveExamples, negativeExamples,
 * conditions, and sourceQuote.
 *
 * Concepts missing sourceQuote or having an empty quote are strictly rejected.
 */
export const ExtractedConceptSchema = z.object({
  conceptKey: z
    .string()
    .trim()
    .min(1, 'conceptKey must not be empty')
    .regex(/^[a-z0-9_.-]+$/i, 'conceptKey must be a valid identifier (alphanumeric/underscore/dash/dot)'),
  name: z.string().trim().min(1, 'name must not be empty'),
  nameFa: z.string().trim().nullable().optional(),
  descriptionFa: z.string().trim().min(1, 'descriptionFa must not be empty'),
  category: z.string().trim().nullable().optional(),
  sensitivity: ConceptSensitivitySchema,
  action: ConceptActionSchema,
  positiveExamples: z.array(z.string().trim()).default([]),
  negativeExamples: z.array(z.string().trim()).default([]),
  conditions: z.array(z.string().trim()).default([]),
  keywords: z.array(z.string().trim()).default([]),
  detectorHints: DetectorHintsSchema.nullable().optional(),
  sourceQuote: z
    .string()
    .trim()
    .min(1, 'sourceQuote is mandatory and must not be empty (spec §13, Rule 10)'),
  sourcePage: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1).default(1.0),
  flags: z.array(z.string()).optional(),
});

export type ExtractedConcept = z.infer<typeof ExtractedConceptSchema>;

/**
 * Server-side validation schema for Admin concept edits (AGENT_TASK §10).
 * Validates non-empty fields, enums, example arrays, and conditions.
 */
export const UpdateConceptSchema = z.object({
  name: z.string().trim().min(1, 'نام مفهوم نمی‌تواند خالی باشد').optional(),
  nameFa: z.string().trim().nullable().optional(),
  descriptionFa: z.string().trim().min(1, 'شرح مفهوم نمی‌تواند خالی باشد').optional(),
  category: z.string().trim().nullable().optional(),
  sensitivity: ConceptSensitivitySchema.optional(),
  action: ConceptActionSchema.optional(),
  positiveExamples: z.array(z.string().trim().min(1, 'نمونه مثبت نمی‌تواند خالی باشد')).optional(),
  negativeExamples: z.array(z.string().trim().min(1, 'نمونه منفی نمی‌تواند خالی باشد')).optional(),
  conditions: z.array(z.string().trim().min(1, 'شرط نمی‌تواند خالی باشد')).optional(),
  keywords: z.array(z.string().trim().min(1, 'کلیدواژه نمی‌تواند خالی باشد')).optional(),
  detectorHints: DetectorHintsSchema.nullable().optional(),
  sourceQuote: z.string().trim().min(1, 'نقل‌قول مبنا نمی‌تواند خالی باشد').optional(),
  sourcePage: z.number().int().positive().nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  reviewStatus: ConceptReviewStatusSchema.optional(),
  reviewNote: z.string().trim().nullable().optional(),
});

export type UpdateConceptPayload = z.infer<typeof UpdateConceptSchema>;

/**
 * Flexible container supporting array directly or wrapped in { concepts: [...] }
 */
export const ExtractedConceptsEnvelopeSchema = z.union([
  z.array(ExtractedConceptSchema),
  z.object({
    concepts: z.array(ExtractedConceptSchema),
  }),
  z.object({
    rules: z.array(ExtractedConceptSchema),
  }),
]);

/**
 * Verifies that a quote exists within the source unit text.
 * Performs both exact substring check and Persian-normalized substring check.
 */
export function findBestMatchingSentence(quote: string, text: string): string | null {
  let cleanQuote = quote.trim().replace(/^[«"']+|[»"']+$/g, '').trim();
  cleanQuote = cleanQuote.replace(/^بخش\/عنوان:\s*[^\n]+\n*/i, '').trim();
  const normQuote = normalizePersian(cleanQuote);
  const quoteWords = normQuote.split(/\s+/).filter((w) => w.length > 1);
  if (quoteWords.length === 0) return null;

  const chunks = text.split(/[\n.!؟؛]+/).map((s) => s.trim()).filter((s) => s.length > 5);
  let bestChunk: string | null = null;
  let bestScore = 0;

  for (const chunk of chunks) {
    const normChunk = normalizePersian(chunk);
    const chunkWords = new Set(normChunk.split(/\s+/));
    const matchCount = quoteWords.filter((w) => chunkWords.has(w)).length;
    const score = matchCount / quoteWords.length;
    if (score > bestScore) {
      bestScore = score;
      bestChunk = chunk;
    }
  }

  return bestScore >= 0.7 ? bestChunk : null;
}

export function verifyQuoteProvenance(sourceQuote: string, sourceText: string): boolean {
  let cleanQuote = sourceQuote.trim().replace(/^[«"']+|[»"']+$/g, '').trim();
  const cleanText = sourceText.trim();

  if (!cleanQuote || !cleanText) {
    return false;
  }

  // If quote starts with "بخش/عنوان: ...", strip the header part
  cleanQuote = cleanQuote.replace(/^بخش\/عنوان:\s*[^\n]+\n*/i, '').trim();

  // 1. Direct substring match
  if (cleanText.includes(cleanQuote)) {
    return true;
  }

  // 2. Normalized Persian match (accounting for numerals, yaa/kaaf, ZWNJ, spacing)
  const normQuote = normalizePersian(cleanQuote);
  const normText = normalizePersian(cleanText);

  if (normText.includes(normQuote)) {
    return true;
  }

  // 3. Relaxed whitespace match
  const collapseWhitespace = (s: string) => s.replace(/\s+/g, ' ').trim();
  if (collapseWhitespace(normText).includes(collapseWhitespace(normQuote))) {
    return true;
  }

  // 4. Token overlap match
  const best = findBestMatchingSentence(cleanQuote, cleanText);
  if (best) {
    return true;
  }

  return false;
}

export interface ConceptValidationResult {
  valid: ExtractedConcept[];
  rejected: Array<{
    data: unknown;
    reason: string;
    errors?: z.ZodError['issues'];
  }>;
}

/**
 * Parses unknown LLM extraction output, validates schema, and optionally
 * enforces source quote provenance against unit text.
 */
export function validateExtractedConcepts(
  input: unknown,
  options?: {
    sourceText?: string;
    requireProvenanceInSourceText?: boolean;
  },
): ConceptValidationResult {
  const valid: ExtractedConcept[] = [];
  const rejected: ConceptValidationResult['rejected'] = [];

  let candidates: unknown[] = [];

  if (typeof input === 'string') {
    let clean = input.trim();
    // Strip <think>...</think> from reasoning models
    clean = clean.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    // Strip markdown code block fences if present
    if (clean.includes('```')) {
      const match = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (match) {
        clean = match[1].trim();
      }
    }
    // Extract outermost { ... } or [ ... ] if surrounded by conversational text
    const jsonStart = clean.search(/[\[{]/);
    const jsonEndBrace = clean.lastIndexOf('}');
    const jsonEndBracket = clean.lastIndexOf(']');
    const jsonEnd = Math.max(jsonEndBrace, jsonEndBracket);
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      clean = clean.slice(jsonStart, jsonEnd + 1);
    }

    try {
      input = JSON.parse(clean);
    } catch (e) {
      return {
        valid: [],
        rejected: [{ data: input, reason: `Invalid JSON payload: ${String(e)}` }],
      };
    }
  }

  if (Array.isArray(input)) {
    candidates = input;
  } else if (input && typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    if (Array.isArray(obj.concepts)) {
      candidates = obj.concepts;
    } else if (Array.isArray(obj.rules)) {
      candidates = obj.rules;
    } else if (Object.keys(obj).length === 0) {
      candidates = [];
    } else {
      // Single concept object
      candidates = [obj];
    }
  } else {
    return {
      valid: [],
      rejected: [{ data: input, reason: 'Payload is neither an array nor a concept object' }],
    };
  }

  for (const item of candidates) {
    const parsed = ExtractedConceptSchema.safeParse(item);
    if (!parsed.success) {
      rejected.push({
        data: item,
        reason: 'Schema validation failed: ' + parsed.error.issues.map((i) => i.message).join('; '),
        errors: parsed.error.issues,
      });
      continue;
    }

    const concept = parsed.data;

    if (options?.requireProvenanceInSourceText && options.sourceText) {
      const hasProvenance = verifyQuoteProvenance(concept.sourceQuote, options.sourceText);
      if (!hasProvenance) {
        rejected.push({
          data: concept,
          reason: `Provenance violation: sourceQuote was not found in the source text (spec §13)`,
        });
        continue;
      }
    }

    const flags: string[] = Array.isArray(concept.flags) ? [...concept.flags] : [];

    // 1. Quote length & ratio check (spec §2.3)
    if (options?.sourceText) {
      const quoteRatio = concept.sourceQuote.length / (options.sourceText.length || 1);
      const looksTooBroad = concept.sourceQuote.length > 350 || (quoteRatio > 0.6 && concept.sourceQuote.length > 150);
      if (looksTooBroad && !flags.includes('LOOKS_TOO_BROAD')) {
        flags.push('LOOKS_TOO_BROAD');
      }
    } else if (concept.sourceQuote.length > 350) {
      if (!flags.includes('LOOKS_TOO_BROAD')) {
        flags.push('LOOKS_TOO_BROAD');
      }
    }

    // 2. Consistency check between sensitivity and action (spec §2.4)
    const isMismatch =
      (concept.sensitivity === 'HIGHLY_CONFIDENTIAL' && (concept.action === 'ALLOW_EXTERNAL' || concept.action === 'MASK_AND_ALLOW_EXTERNAL')) ||
      (concept.sensitivity === 'CONFIDENTIAL' && concept.action === 'ALLOW_EXTERNAL') ||
      (concept.sensitivity === 'PUBLIC' && (concept.action === 'BLOCK' || concept.action === 'ROUTE_LOCAL'));

    if (isMismatch && !flags.includes('SENSITIVITY_ACTION_MISMATCH')) {
      flags.push('SENSITIVITY_ACTION_MISMATCH');
    }

    concept.flags = flags;
    valid.push(concept);
  }

  return { valid, rejected };
}
