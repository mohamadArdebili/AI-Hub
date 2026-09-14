// Retrieval Evaluator — Recall@K and MRR Metrics
// (MIGRATION_PLAN_REVIEWED_v1.1 §3.6, spec §50)

import type { HybridRetriever } from './hybrid-retriever';

export interface EvalQueryItem {
  prompt: string;
  expectedConcepts: string[];
  category?: string;
}

export interface RetrievalEvaluationMetrics {
  totalQueries: number;
  evaluatedQueries: number;
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrr: number; // Mean Reciprocal Rank
}

/**
 * Runs evaluation on a set of labeled queries against the hybrid retriever.
 * Computes Recall@1, Recall@3, Recall@5, and MRR.
 */
export async function evaluateRetriever(
  retriever: HybridRetriever,
  dataset: EvalQueryItem[],
  options: { organizationId: string; documentId?: string },
): Promise<RetrievalEvaluationMetrics> {
  const sensitiveQueries = dataset.filter((q) => q.expectedConcepts.length > 0);
  if (sensitiveQueries.length === 0) {
    return {
      totalQueries: dataset.length,
      evaluatedQueries: 0,
      recallAt1: 0,
      recallAt3: 0,
      recallAt5: 0,
      mrr: 0,
    };
  }

  let hitsAt1 = 0;
  let hitsAt3 = 0;
  let hitsAt5 = 0;
  let sumReciprocalRank = 0;

  for (const item of sensitiveQueries) {
    const results = await retriever.retrieve(item.prompt, {
      organizationId: options.organizationId,
      documentId: options.documentId,
      topK: 5,
    });

    const retrievedKeys = results.map((r) => r.concept.conceptKey);

    // Recall@1
    if (retrievedKeys.slice(0, 1).some((k) => item.expectedConcepts.includes(k))) {
      hitsAt1++;
    }

    // Recall@3
    if (retrievedKeys.slice(0, 3).some((k) => item.expectedConcepts.includes(k))) {
      hitsAt3++;
    }

    // Recall@5
    if (retrievedKeys.slice(0, 5).some((k) => item.expectedConcepts.includes(k))) {
      hitsAt5++;
    }

    // Reciprocal Rank
    let firstRank = 0;
    for (let i = 0; i < retrievedKeys.length; i++) {
      if (item.expectedConcepts.includes(retrievedKeys[i])) {
        firstRank = i + 1;
        break;
      }
    }

    if (firstRank > 0) {
      sumReciprocalRank += 1 / firstRank;
    }
  }

  const count = sensitiveQueries.length;
  return {
    totalQueries: dataset.length,
    evaluatedQueries: count,
    recallAt1: hitsAt1 / count,
    recallAt3: hitsAt3 / count,
    recallAt5: hitsAt5 / count,
    mrr: sumReciprocalRank / count,
  };
}
