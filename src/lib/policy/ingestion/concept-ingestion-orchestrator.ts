// Concept Ingestion Orchestrator — End-to-End Pipeline
// (MIGRATION_PLAN_REVIEWED_v1.1 §2.6, spec §13, §42, §71 Phase 2)

import path from 'path';
import { db } from '@/lib/db/client';
import { extractPdfPages, extractTextDocument, type ExtractedPage } from './pdf-extractor';
import { segmentDocument } from './segmenter';
import {
  createPolicyUnits,
  createConcept,
  addConceptSource,
  getConceptByKey,
} from '../concepts/repository';
import { OllamaPolicyConceptExtractor, type PolicyConceptExtractor } from '../local-llm/concept-extractor';
import { createPolicyAuditLog } from '@/lib/db/audit-repository';

export interface IngestionReport {
  documentId: string;
  unitsCount: number;
  candidateUnitsCount: number;
  conceptsExtracted: number;
  conceptsSaved: number;
  rejectedCount: number;
  modelUsed?: string;
  errors?: string[];
}

export async function ingestDocumentConcepts(
  filePath: string,
  documentId: string,
  organizationId: string,
  options: {
    extractor?: PolicyConceptExtractor;
    sourceType?: 'PDF' | 'TXT' | 'MD';
  } = {},
): Promise<IngestionReport> {
  const isTxt =
    options.sourceType === 'TXT' ||
    options.sourceType === 'MD' ||
    filePath.endsWith('.txt') ||
    filePath.endsWith('.md');

  // 1. Extract pages & repair Persian text
  let pages: ExtractedPage[];
  if (isTxt) {
    pages = extractTextDocument(filePath, { repairPersian: true });
  } else {
    pages = await extractPdfPages(filePath, { repairPersian: true });
  }

  // 2. Segment document into structured units
  const segmented = segmentDocument(pages);

  // Clean up previous PolicyUnits and unreviewed concepts for this document
  await db.policyUnit.deleteMany({ where: { documentId } });
  await db.policyConcept.deleteMany({
    where: { documentId, reviewStatus: { in: ['REVIEW', 'DRAFT'] } },
  });

  // 3. Persist PolicyUnits into database
  const createdUnits = await createPolicyUnits(
    segmented.map((u) => ({
      documentId,
      ordinal: u.ordinal,
      page: u.page,
      sectionTitle: u.sectionTitle,
      text: u.text,
      normalizedText: u.normalizedText,
      unitType: u.unitType,
      spanStart: u.spanStart,
      spanEnd: u.spanEnd,
      isCandidate: u.isCandidate,
    })),
  );

  // 4. Prioritize candidate units for LLM extraction (spec §42)
  const candidateUnits = createdUnits.filter(
    (u) =>
      u.unitType !== 'HEADING' && (
        u.isCandidate ||
        u.unitType === 'CLAUSE' ||
        u.unitType === 'PARAGRAPH' ||
        (u.unitType === 'BULLET_GROUP' && u.text.length > 30)
      ),
  );

  const extractor = options.extractor ?? new OllamaPolicyConceptExtractor();

  let conceptsExtracted = 0;
  let conceptsSaved = 0;
  let rejectedCount = 0;
  let modelUsed: string | undefined;
  const errors: string[] = [];

  for (const unit of candidateUnits) {
    // Only extract from units with meaningful policy content length
    if (unit.text.length < 20) continue;

    try {
      const result = await extractor.extract({
        id: unit.id,
        text: unit.text,
        sectionTitle: unit.sectionTitle,
        page: unit.page,
      });

      if (result.modelUsed) modelUsed = result.modelUsed;
      conceptsExtracted += result.concepts.length;
      rejectedCount += result.rejected.length;

      for (const extracted of result.concepts) {
        // Check if conceptKey already exists for this document; if so, add source
        const existing = await getConceptByKey(organizationId, documentId, extracted.conceptKey);
        if (existing) {
          await addConceptSource(existing.id, {
            quote: extracted.sourceQuote,
            unitId: unit.id,
            page: extracted.sourcePage ?? unit.page,
          });
        } else {
          // Persist as REVIEW (spec §13: never active automatically)
          await createConcept({
            organizationId,
            documentId,
            unitId: unit.id,
            conceptKey: extracted.conceptKey,
            name: extracted.name,
            nameFa: extracted.nameFa,
            descriptionFa: extracted.descriptionFa,
            category: extracted.category || unit.sectionTitle,
            sensitivity: extracted.sensitivity,
            action: extracted.action,
            positiveExamples: extracted.positiveExamples,
            negativeExamples: extracted.negativeExamples,
            conditions: extracted.conditions,
            keywords: extracted.keywords,
            flags: extracted.flags,
            sourceQuote: extracted.sourceQuote,
            sourcePage: extracted.sourcePage ?? unit.page,
            confidence: extracted.confidence,
            reviewStatus: 'REVIEW',
            extractedByModel: modelUsed,
            sources: [
              {
                unitId: unit.id,
                page: extracted.sourcePage ?? unit.page,
                quote: extracted.sourceQuote,
              },
            ],
          });
          conceptsSaved++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Unit ${unit.ordinal} extraction error: ${msg}`);
    }
  }

  // 5. Update PolicyDocument metadata & stats
  const stats = {
    unitsCount: createdUnits.length,
    candidateUnitsCount: candidateUnits.length,
    conceptsExtracted,
    conceptsSaved,
    rejectedCount,
    modelUsed,
  };

  await db.policyDocument.update({
    where: { id: documentId },
    data: {
      conceptExtractionStatus: 'DONE',
      conceptStats: JSON.stringify(stats),
      lifecycle: 'REVIEW',
      reviewedAt: new Date(),
    },
  });

  // 6. Audit log
  await createPolicyAuditLog({
    organizationId,
    action: 'CONCEPT_EXTRACTION',
    targetType: 'POLICY_DOCUMENT',
    targetId: documentId,
    metadataJson: JSON.stringify(stats),
  });

  return {
    documentId,
    unitsCount: createdUnits.length,
    candidateUnitsCount: candidateUnits.length,
    conceptsExtracted,
    conceptsSaved,
    rejectedCount,
    modelUsed,
    errors: errors.length > 0 ? errors : undefined,
  };
}
