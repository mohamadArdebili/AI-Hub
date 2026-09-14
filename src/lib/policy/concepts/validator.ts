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
});

export type ExtractedConcept = z.infer<typeof ExtractedConceptSchema>;

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
export function verifyQuoteProvenance(sourceQuote: string, sourceText: string): boolean {
  const cleanQuote = sourceQuote.trim();
  const cleanText = sourceText.trim();

  if (!cleanQuote || !cleanText) {
    return false;
  }

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
    try {
      input = JSON.parse(input);
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

    valid.push(concept);
  }

  return { valid, rejected };
}
