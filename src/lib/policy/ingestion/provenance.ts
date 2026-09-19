// Provenance Validator & Multi-Source Tracker
// (MIGRATION_PLAN_REVIEWED_v1.1 §2.5, spec §13, §71 Phase 2, Rule 10)

import { verifyQuoteProvenance, findBestMatchingSentence } from '../concepts/validator';
import type { ExtractedConcept } from '../concepts/validator';
import type { PolicyUnit } from '../concepts/types';

export interface ProvenanceVerificationResult {
  valid: boolean;
  conceptKey: string;
  sourceQuote: string;
  unitId?: string | null;
  reason?: string;
}

/**
 * Strictly verifies that a concept's primary quote and all secondary source quotes
 * exist within the corresponding policy unit text (spec §13).
 * Concepts without provenance or with fabricated quotes must fail closed.
 */
export function verifyConceptProvenance(
  concept: ExtractedConcept,
  unitText: string,
): ProvenanceVerificationResult {
  const quote = concept.sourceQuote?.trim();

  if (!quote) {
    return {
      valid: false,
      conceptKey: concept.conceptKey,
      sourceQuote: '',
      reason: 'Missing mandatory sourceQuote (Rule 10, spec §13)',
    };
  }

  const isVerified = verifyQuoteProvenance(quote, unitText);
  if (!isVerified) {
    return {
      valid: false,
      conceptKey: concept.conceptKey,
      sourceQuote: quote,
      reason: `sourceQuote was not found in the source unit text: "${quote.slice(0, 60)}..."`,
    };
  }

  // If the quote had minor variations (e.g. dropped preposition), snap to exact sentence from unitText
  if (!unitText.includes(concept.sourceQuote)) {
    const best = findBestMatchingSentence(concept.sourceQuote, unitText);
    if (best) {
      concept.sourceQuote = best;
    }
  }

  return {
    valid: true,
    conceptKey: concept.conceptKey,
    sourceQuote: concept.sourceQuote,
  };
}

/**
 * Validates a batch of extracted concepts against their originating unit.
 * Filters out invalid concepts and preserves provenance rejection audit logs.
 */
export function filterConceptsByProvenance(
  concepts: ExtractedConcept[],
  unit: { id?: string; text: string; page?: number | null },
): {
  accepted: ExtractedConcept[];
  rejected: Array<{ concept: ExtractedConcept; reason: string }>;
} {
  const accepted: ExtractedConcept[] = [];
  const rejected: Array<{ concept: ExtractedConcept; reason: string }> = [];

  for (const c of concepts) {
    const check = verifyConceptProvenance(c, unit.text);
    if (check.valid) {
      // Ensure sourcePage is set if unit has page
      if (unit.page && !c.sourcePage) {
        c.sourcePage = unit.page;
      }
      accepted.push(c);
    } else {
      rejected.push({
        concept: c,
        reason: check.reason ?? 'Provenance check failed',
      });
    }
  }

  return { accepted, rejected };
}
