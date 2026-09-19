/** bun scripts/repair-policy-routing.ts <document-id> [--apply] [--activate]
 * Preview first. --apply re-extracts into REVIEW; --activate approves the reviewed
 * clauses plus the explicit organization overrides and requires a complete index.
 */
import { db } from '../src/lib/db/client';
import { extractPdfPages } from '../src/lib/policy/ingestion/pdf-extractor';
import { segmentDocument } from '../src/lib/policy/ingestion/segmenter';
import { OllamaPolicyConceptExtractor } from '../src/lib/policy/local-llm/concept-extractor';
import { ingestDocumentConcepts } from '../src/lib/policy/ingestion/concept-ingestion-orchestrator';
import { createConcept, approveConcept, listConcepts } from '../src/lib/policy/concepts/repository';
import { activatePolicyDocument, activatePolicyRulesForDocument, createPolicyAuditLog } from '../src/lib/db';
import { PrismaVectorStore } from '../src/lib/policy/retrieval/vector-store';
import { OllamaEmbeddingProvider } from '../src/lib/policy/retrieval/embeddings';
import { ExtractedConceptSchema, type ExtractedConcept } from '../src/lib/policy/concepts/validator';
import overrides from '../docs/routing-policy-overrides.json';

const id = process.argv[2];
if (!id || id.startsWith('--')) throw new Error('A document ID is required');
try {
  const doc = await db.policyDocument.findUniqueOrThrow({ where: { id } });
  const extractor = new OllamaPolicyConceptExtractor();
  const units = segmentDocument(await extractPdfPages(doc.storagePath, { repairPersian: true }));
  const extracted: ExtractedConcept[] = [];
  for (const unit of units.filter(u => u.unitType !== 'HEADING')) {
    const result = await extractor.extract(unit);
    if (result.rejected.length) throw new Error('Extraction rejected a clause; review before repair');
    extracted.push(...result.concepts);
  }
  if (extracted.map(c => c.conceptKey).sort().join(',') !== 'fin_001,pii_001,sec_001' ||
      extracted.some(c => c.action !== 'ROUTE_LOCAL' || !c.conditions.length)) {
    throw new Error('Unexpected document content; repair requires the reviewed three-clause policy');
  }
  const additions = overrides.map(c => ExtractedConceptSchema.parse(c));
  console.log(JSON.stringify({ documentId: id, pdfRules: extracted, organizationOverrides: additions }, null, 2));
  if (process.argv.includes('--apply')) {
    // Reprocessing a reviewed policy must not silently overwrite prior approvals.
    const existing = await listConcepts(doc.organizationId, { documentId: id });
    if (existing.some(c => c.reviewStatus === 'ACTIVE')) throw new Error('Active concepts already exist; review manually');
    await ingestDocumentConcepts(doc.storagePath, id, doc.organizationId, { extractor });
    for (const concept of additions) {
      await createConcept({ ...concept, documentId: id, organizationId: doc.organizationId,
        reviewStatus: 'REVIEW', extractedByModel: 'organization-override',
        reviewNote: 'Explicit user-approved routing requirements; not extracted from the PDF.' });
    }
  }
  if (process.argv.includes('--activate')) {
    const concepts = await listConcepts(doc.organizationId, { documentId: id });
    if (concepts.length !== 5 || concepts.some(c => ![...extracted, ...additions].some(e =>
      e.conceptKey === c.conceptKey && e.action === c.action && e.descriptionFa === c.descriptionFa && e.sourceQuote === c.sourceQuote))) {
      throw new Error('Persisted concepts differ from reviewed source; activation refused');
    }
    for (const concept of concepts.filter(c => c.reviewStatus === 'REVIEW')) {
      await approveConcept(concept.id, doc.organizationId, 'Reviewed against policy_3.pdf and explicit user routing requirements.');
    }
    const result = await new PrismaVectorStore().rebuildIndex(doc.organizationId, id, new OllamaEmbeddingProvider());
    if (result.failed || result.indexed !== 5) throw new Error('Incomplete index; policy remains in REVIEW');
    await activatePolicyDocument(id, doc.organizationId);
    await activatePolicyRulesForDocument(doc.organizationId, id);
    await createPolicyAuditLog({ organizationId: doc.organizationId, action: 'ACTIVATION',
      targetType: 'POLICY_DOCUMENT', targetId: id,
      metadata: { source: 'reviewed-policy-routing-repair', concepts: concepts.map(c => c.conceptKey), ...result } });
    console.log('Activated five reviewed concepts with a complete index.');
  }
} finally {
  await db.$disconnect();
}
