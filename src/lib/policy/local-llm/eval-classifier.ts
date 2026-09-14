// Semantic Policy Classifier Evaluator — Accuracy, Precision, Recall, F1 Metrics
// (MIGRATION_PLAN_REVIEWED_v1.1 §4.5, spec §28, §50)

import type {
  PolicySemanticClassifier,
  SemanticClassifierInput,
  SemanticConceptCandidate,
  SemanticDecision,
  SemanticScope,
} from './semantic-classifier';

export interface ClassifierEvalItem {
  prompt: string;
  candidateConcepts: SemanticConceptCandidate[];
  expectedDecision: SemanticDecision;
  expectedScope?: SemanticScope;
  expectedMatchedConcepts?: string[];
  category?: string;
}

export interface ClassifierEvaluationMismatch {
  prompt: string;
  expectedDecision: SemanticDecision;
  actualDecision: SemanticDecision;
  expectedScope?: SemanticScope;
  actualScope: SemanticScope;
  confidence: number;
  reasonFa: string;
  method: string;
}

export interface ClassifierEvaluationMetrics {
  totalQueries: number;
  evaluatedQueries: number;
  accuracy: number;
  sensitivePrecision: number;
  sensitiveRecall: number;
  sensitiveF1: number;
  safeAccuracy: number;
  fallbackCount: number;
  avgLatencyMs: number;
  mismatches: ClassifierEvaluationMismatch[];
}

/**
 * Evaluates a PolicySemanticClassifier against a labeled dataset.
 */
export async function evaluateSemanticClassifier(
  classifier: PolicySemanticClassifier,
  dataset: ClassifierEvalItem[],
  options?: { timeoutMs?: number },
): Promise<ClassifierEvaluationMetrics> {
  let correctDecisions = 0;
  let truePositives = 0; // expected SENSITIVE, classified SENSITIVE
  let falsePositives = 0; // expected SAFE, classified SENSITIVE
  let trueNegatives = 0; // expected SAFE, classified SAFE
  let falseNegatives = 0; // expected SENSITIVE, classified SAFE or UNCERTAIN
  let totalSensitive = 0;
  let totalSafe = 0;
  let fallbackCount = 0;
  let totalLatencyMs = 0;
  const mismatches: ClassifierEvaluationMismatch[] = [];

  for (const item of dataset) {
    if (item.expectedDecision === 'SENSITIVE') totalSensitive++;
    if (item.expectedDecision === 'SAFE') totalSafe++;

    const input: SemanticClassifierInput = {
      prompt: item.prompt,
      candidateConcepts: item.candidateConcepts,
      timeoutMs: options?.timeoutMs,
    };

    const result = await classifier.classify(input);
    totalLatencyMs += result.latencyMs;

    if (result.method === 'fallback' || result.decision === 'UNCERTAIN') {
      fallbackCount++;
    }

    const isMatch = result.decision === item.expectedDecision;
    if (isMatch) {
      correctDecisions++;
    } else {
      mismatches.push({
        prompt: item.prompt,
        expectedDecision: item.expectedDecision,
        actualDecision: result.decision,
        expectedScope: item.expectedScope,
        actualScope: result.scope,
        confidence: result.confidence,
        reasonFa: result.reasonFa,
        method: result.method,
      });
    }

    if (item.expectedDecision === 'SENSITIVE') {
      if (result.decision === 'SENSITIVE') {
        truePositives++;
      } else {
        falseNegatives++;
      }
    } else if (item.expectedDecision === 'SAFE') {
      if (result.decision === 'SAFE') {
        trueNegatives++;
      } else if (result.decision === 'SENSITIVE') {
        falsePositives++;
      }
    }
  }

  const evaluatedQueries = dataset.length;
  const accuracy = evaluatedQueries > 0 ? correctDecisions / evaluatedQueries : 0;
  const precisionDenominator = truePositives + falsePositives;
  const sensitivePrecision =
    precisionDenominator > 0 ? truePositives / precisionDenominator : 0;
  const sensitiveRecall =
    totalSensitive > 0 ? truePositives / totalSensitive : 0;
  const sensitiveF1 =
    sensitivePrecision + sensitiveRecall > 0
      ? (2 * sensitivePrecision * sensitiveRecall) / (sensitivePrecision + sensitiveRecall)
      : 0;
  const safeAccuracy = totalSafe > 0 ? trueNegatives / totalSafe : 0;
  const avgLatencyMs = evaluatedQueries > 0 ? totalLatencyMs / evaluatedQueries : 0;

  return {
    totalQueries: dataset.length,
    evaluatedQueries,
    accuracy,
    sensitivePrecision,
    sensitiveRecall,
    sensitiveF1,
    safeAccuracy,
    fallbackCount,
    avgLatencyMs,
    mismatches,
  };
}
