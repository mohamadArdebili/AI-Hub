// Action-Aware Decision Engine
// (MIGRATION_PLAN_REVIEWED_v1.1 §5.3, spec §57 Step 9, spec §4.2)

import type { DetectionOutcome, RuntimeAction, SensitivityDecision } from '../types';
import type { FusedEvidence } from './evidence-fusion';

export type PolicyRoute = 'EXTERNAL_DIRECT' | 'EXTERNAL_MASKED' | 'LOCAL' | 'BLOCKED';

export interface DecisionEngineInput {
  fusedEvidence: FusedEvidence;
  normalizedInputHash: string;
  durationMs: number;
  policyVersion?: number;
  minClassifierConfidence?: number; // default: 0.70
}

export interface DecisionEngineResult {
  route: PolicyRoute;
  decision: SensitivityDecision;
  action: RuntimeAction;
  outcome: DetectionOutcome;
}

/**
 * Pure action-aware decision engine mapping fused evidence to a final route
 * and backwards-compatible DetectionOutcome.
 */
export function decidePolicyRoute(input: DecisionEngineInput): DecisionEngineResult {
  const { fusedEvidence, normalizedInputHash, durationMs, policyVersion } = input;
  const minConfidence = input.minClassifierConfidence ?? 0.7;

  let route: PolicyRoute;
  let decision: SensitivityDecision;
  let reason: string;

  // 1. BLOCK: Non-negotiable precedence (spec §4.2 B & C)
  if (fusedEvidence.precedenceAction === 'BLOCK' &&
      (fusedEvidence.deterministicHits.some(h => h.alwaysBlock) ||
       (fusedEvidence.pipelineHealth === 'HEALTHY' && fusedEvidence.semanticConfidence >= minConfidence &&
        fusedEvidence.semanticDecision === 'SENSITIVE'))) {
    route = 'BLOCKED';
    decision = 'SENSITIVE';
    reason =
      fusedEvidence.reasons[0] ??
      'درخواست به دلیل نقض قواعد حیاتی امنیت اطلاعات مسدود گردید (BLOCKED)';
  }
  // 2. Fail-Closed conditions -> LOCAL (spec §4.2 G)
  else if (
    fusedEvidence.pipelineHealth !== 'HEALTHY' ||
    fusedEvidence.hasCriticalConflict ||
    fusedEvidence.semanticDecision === 'UNCERTAIN' ||
    fusedEvidence.semanticScope === 'UNKNOWN' ||
    fusedEvidence.semanticConfidence < minConfidence
  ) {
    route = 'LOCAL';
    decision = fusedEvidence.semanticDecision === 'UNCERTAIN' ? 'UNCERTAIN' : 'SENSITIVE';
    reason =
      fusedEvidence.reasons[0] ??
      'به دلیل عدم قطعیت یا کاهش سطح سلامت پایپ‌لاین تشخیص، درخواست به مسیر امن محلی ارجاع شد (fail-closed)';
  }
  // 3. MASK_AND_ALLOW_EXTERNAL: Explicit policy action
  else if (fusedEvidence.precedenceAction === 'MASK_AND_ALLOW_EXTERNAL') {
    route = 'LOCAL';
    decision = 'SENSITIVE';
    reason =
      fusedEvidence.reasons[0] ??
      'ارسال پس از ماسک‌گذاری در این مرحله مجاز نیست؛ ارجاع به مسیر محلی';
  }
  // 4. SENSITIVE / ROUTE_LOCAL: Targeted organizational secrets
  else if (
    fusedEvidence.precedenceAction === 'ROUTE_LOCAL' ||
    fusedEvidence.semanticDecision === 'SENSITIVE' ||
    fusedEvidence.semanticScope === 'ORG_SPECIFIC'
  ) {
    route = 'LOCAL';
    decision = 'SENSITIVE';
    reason =
      fusedEvidence.reasons[0] ??
      'درخواست حاوی داده‌های اختصاصی یا حساس سازمانی است و به مسیر امن محلی ارجاع شد';
  }
  // 5. EXTERNAL_DIRECT: Clean, high-confidence SAFE general query (spec §4.2 E)
  else if (
    fusedEvidence.semanticDecision === 'SAFE' &&
    fusedEvidence.semanticConfidence >= minConfidence &&
    fusedEvidence.semanticScope === 'GENERAL' &&
    fusedEvidence.deterministicHits.length === 0 &&
    fusedEvidence.precedenceAction === 'ALLOW_EXTERNAL'
  ) {
    route = 'EXTERNAL_DIRECT';
    decision = 'SAFE';
    reason = 'درخواست عمومی و ایمن ارزیابی شد و مجوز ارسال مستقیم به مدل خارجی صادر گردید';
  }
  // 6. Default Fallback -> LOCAL (Fail-Closed)
  else {
    route = 'LOCAL';
    decision = 'UNCERTAIN';
    reason = 'شرایط ارسال امن خارجی احراز نشد؛ ارجاع به مسیر امن محلی (fail-closed)';
  }

  // Map route to RuntimeAction
  const action: RuntimeAction =
    route === 'EXTERNAL_DIRECT'
      ? 'EXTERNAL_ALLOWED'
      : 'LOCAL_ONLY';

  const outcome: DetectionOutcome = {
    decision,
    action,
    hits: fusedEvidence.deterministicHits,
    processing: {
      normalizedInputHash,
      durationMs: Math.round(durationMs),
      localLlmUsed: true,
      externalLlmInvoked: false, // Contractual security invariant
    },
    reason,
    sensitivity: fusedEvidence.highestSensitivity,
    matchedConcepts: fusedEvidence.matchedConcepts.map((c) => ({
      conceptId: c.id,
      conceptKey: c.conceptKey,
      name: c.name,
      nameFa: c.nameFa ?? null,
      category: c.category ?? c.sectionTitle ?? c.nameFa ?? c.name,
      sensitivity: c.sensitivity,
      action: c.action,
      score: 1.0,
      reason: c.descriptionFa,
    })),
    classifier: {
      method: fusedEvidence.pipelineHealth === 'HEALTHY' ? 'local_llm' : 'fallback',
      confidence: fusedEvidence.semanticConfidence,
      reason,
    },
    route,
    pipelineHealth: fusedEvidence.pipelineHealth,
    policyVersion,
  };

  return {
    route,
    decision,
    action,
    outcome,
  };
}
