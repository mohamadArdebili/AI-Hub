/** Read-only live local-model evaluation. No external provider or decision-log writes. */
import { writeFileSync } from 'fs';
import { extractPdfPages } from '../src/lib/policy/ingestion/pdf-extractor';
import { segmentDocument } from '../src/lib/policy/ingestion/segmenter';
import { extractExplicitRule } from '../src/lib/policy/ingestion/explicit-rule-extractor';
import { runDetectionV2 } from '../src/lib/policy/detection/detection-pipeline';
import { detectConversation, serializeConversation, type PolicyMessage } from '../src/lib/policy/conversation';
import { OllamaSemanticPolicyClassifier } from '../src/lib/policy/local-llm/semantic-classifier';
import type { HybridRetriever } from '../src/lib/policy/retrieval/hybrid-retriever';
import type { PolicyConcept } from '../src/lib/policy/concepts/types';
import { db } from '../src/lib/db/client';
import overrides from '../docs/routing-policy-overrides.json';
import cases from '../eval/policy-3-routing.json';

const units = segmentDocument(await extractPdfPages('__tests__/fixtures/policy_3.pdf', { repairPersian: true }));
const concepts = [...units.flatMap(u => extractExplicitRule(u.text, u.page) ?? []), ...overrides]
  .map(c => ({ ...c, id: c.conceptKey, organizationId: 'evaluation', documentId: 'evaluation', reviewStatus: 'ACTIVE', confidence: 1 })) as PolicyConcept[];
const retriever = { retrieve: async () => concepts.map(concept => ({ concept, score: 1 })) } as unknown as HybridRetriever;
const classifier = new OllamaSemanticPolicyClassifier();
if (process.argv.includes('--diagnostic')) {
  for (const prompt of ['What is Python?', 'پایتون چیست؟', 'حقوق مدیر چقدر است؟', 'یک نامه محرمانه به علی بنویس']) {
    const result = await classifier.classify({ prompt, candidateConcepts: concepts, timeoutMs: 15000 });
    console.log(JSON.stringify(result));
  }
  process.exit(0);
}
const organizationId = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const limit = Number(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? cases.length);
const caseIndex = process.argv.find(arg => arg.startsWith('--case='))?.split('=')[1];
const selectedCases = caseIndex === undefined ? cases.slice(0, limit) : cases.filter((_, index) => index === Number(caseIndex));
if (!selectedCases.length) throw new Error('No evaluation cases selected');
const timeout = process.argv.find(arg => arg.startsWith('--timeout='))?.split('=')[1];
if (timeout) process.env.POLICY_DETECTION_TIMEOUT_MS = timeout;
const report: Array<{ pass: boolean; [key: string]: unknown }> = [];
try {
  for (const entry of selectedCases) {
    const messages = (entry.messages ?? [{ role: 'user', content: entry.prompt }]) as PolicyMessage[];
    const result = organizationId ? await detectConversation(messages, organizationId) : await runDetectionV2({
      prompt: serializeConversation(messages), messages, organizationId: 'evaluation', classifier, hybridRetriever: retriever,
    });
    const row = { ...entry, route: result.route, pass: result.route === entry.expected,
      reason: result.reason, classifier: result.classifier, matchedConcepts: result.matchedConcepts?.map(c => c.conceptKey), elapsedMs: result.processing.durationMs };
    report.push(row); console.log(JSON.stringify(row));
  }
  const summary = { passed: report.filter(r => r.pass).length, total: report.length, mode: organizationId ? 'full-runtime' : 'classifier-with-reviewed-candidates' };
  writeFileSync(`eval/reports/policy-3-routing${caseIndex === undefined ? '' : '-targeted'}.json`, JSON.stringify({ summary, results: report }, null, 2));
  console.log(JSON.stringify(summary));
  if (summary.passed !== summary.total) process.exitCode = 1;
} finally { await db.$disconnect(); }
