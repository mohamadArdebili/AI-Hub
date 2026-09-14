// Policy Engine — main evaluate function — standalone, no Next.js imports

import type { PolicyDecision, PolicySnapshot } from './types';
import { normalizePersian } from './normalize';
import {
  detectSensitiveData,
  detectKeywordRules,
  detectSimilarity,
  detectBehavioralPatterns,
} from './detectors';

/**
 * @deprecated Deprecated in Phase 6 (MIGRATION_PLAN_REVIEWED_v1.1 §6.6).
 * Use `runDetection` / `runDetectionV2` from `@/lib/policy/detection/detection-pipeline` instead.
 * Retained temporarily only for backwards compatibility with legacy UI previews.
 */
export async function evaluate(input: {
  prompt: string;
  organizationId: string;
  policySnapshot: PolicySnapshot | null;
}): Promise<PolicyDecision> {
  const startTime = performance.now();
  const engineVersion = process.env.POLICY_ENGINE_VERSION ?? '1.0.0';

  try {
    // Fail-closed: no policy snapshot → BLOCK
    if (input.policySnapshot === null) {
      const latencyMs = performance.now() - startTime;
      return {
        action: 'BLOCK',
        reasons: ['امکان ارزیابی سیاست‌های سازمان وجود ندارد'],
        matchedRules: [],
        score: 1.0,
        latencyMs,
        engineVersion,
      };
    }

    const { prompt, policySnapshot } = input;

    // Normalize the prompt
    const normalizedPrompt = normalizePersian(prompt);

    // Aggregate results
    const allReasons: string[] = [];
    const allMatchedRules = new Map<string, PolicyDecision['matchedRules'][number]>();
    let maxScore = 0;
    let hasCritical = false;

    function aggregateResult(result: import('./types').DetectionResult): boolean {
      for (const reason of result.reasons) {
        if (!allReasons.includes(reason)) {
          allReasons.push(reason);
        }
      }
      for (const mr of result.matchedRules) {
        if (!allMatchedRules.has(mr.code)) {
          allMatchedRules.set(mr.code, mr);
        }
      }
      maxScore = Math.max(maxScore, result.score);
      return result.blocked;
    }

    function hasCriticalSeverity(): boolean {
      for (const mr of allMatchedRules.values()) {
        if (mr.severity === 'CRITICAL') return true;
      }
      return false;
    }

    // Layer 1: Sensitive Data Detection
    const sensitiveResult = detectSensitiveData(prompt, normalizedPrompt);
    if (aggregateResult(sensitiveResult)) {
      if (hasCriticalSeverity()) {
        const latencyMs = performance.now() - startTime;
        return {
          action: 'BLOCK',
          reasons: allReasons,
          matchedRules: Array.from(allMatchedRules.values()),
          score: maxScore,
          latencyMs,
          engineVersion,
        };
      }
    }

    // Layer 2: Keyword Rules Detection
    const keywordResult = detectKeywordRules(normalizedPrompt, policySnapshot.rules);
    if (aggregateResult(keywordResult)) {
      if (hasCriticalSeverity()) {
        const latencyMs = performance.now() - startTime;
        return {
          action: 'BLOCK',
          reasons: allReasons,
          matchedRules: Array.from(allMatchedRules.values()),
          score: maxScore,
          latencyMs,
          engineVersion,
        };
      }
    }

    // Layer 3: BM25 Similarity Detection
    const similarityResult = detectSimilarity(
      normalizedPrompt,
      policySnapshot.rules,
      policySnapshot.chunks,
    );
    if (aggregateResult(similarityResult)) {
      if (hasCriticalSeverity()) {
        const latencyMs = performance.now() - startTime;
        return {
          action: 'BLOCK',
          reasons: allReasons,
          matchedRules: Array.from(allMatchedRules.values()),
          score: maxScore,
          latencyMs,
          engineVersion,
        };
      }
    }

    // Layer 4: Behavioral Patterns Detection
    const behavioralResult = detectBehavioralPatterns(normalizedPrompt, prompt);
    if (aggregateResult(behavioralResult)) {
      if (hasCriticalSeverity()) {
        const latencyMs = performance.now() - startTime;
        return {
          action: 'BLOCK',
          reasons: allReasons,
          matchedRules: Array.from(allMatchedRules.values()),
          score: maxScore,
          latencyMs,
          engineVersion,
        };
      }
    }

    // If any layer blocked (non-critical), still return BLOCK
    if (allReasons.length > 0) {
      const latencyMs = performance.now() - startTime;
      return {
        action: 'BLOCK',
        reasons: allReasons,
        matchedRules: Array.from(allMatchedRules.values()),
        score: maxScore,
        latencyMs,
        engineVersion,
      };
    }

    // All clear
    const latencyMs = performance.now() - startTime;
    return {
      action: 'ALLOW',
      reasons: [],
      matchedRules: [],
      score: 0,
      latencyMs,
      engineVersion,
    };
  } catch {
    // Fail-closed: any error → BLOCK
    const latencyMs = performance.now() - startTime;
    return {
      action: 'BLOCK',
      reasons: ['خطا در ارزیابی سیاست‌های سازمان'],
      matchedRules: [],
      score: 1.0,
      latencyMs,
      engineVersion,
    };
  }
}
