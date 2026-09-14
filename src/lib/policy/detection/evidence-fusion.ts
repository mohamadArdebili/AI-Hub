// Evidence Fusion Layer
// (MIGRATION_PLAN_REVIEWED_v1.1 §5.2, spec §57 Step 8, spec §4.2, Rule 7)

import type { PolicyConcept, RetrievedConcept, SensitivityLevel, ConceptAction } from '../concepts/types';
import type { DeterministicDlpResult, DeterministicHit } from './deterministic-dlp';
import type { SemanticClassifierResult, SemanticDecision, SemanticScope } from '../local-llm/semantic-classifier';

export interface EvidenceFusionInput {
  deterministic: DeterministicDlpResult;
  retrievedConcepts?: RetrievedConcept[];
  semanticEvidence?: SemanticClassifierResult;
  pipelineDegraded?: boolean;
  degradationReason?: string;
  policyVersion?: number;
  indexValid?: boolean;
}

export interface FusedEvidence {
  pipelineHealth: 'HEALTHY' | 'DEGRADED' | 'FAILED';
  deterministicHits: DeterministicHit[];
  matchedConcepts: PolicyConcept[];
  highestSensitivity: SensitivityLevel;
  precedenceAction: ConceptAction;
  semanticDecision: SemanticDecision;
  semanticScope: SemanticScope;
  semanticConfidence: number;
  hasCriticalConflict: boolean;
  reasons: string[];
}

const SENSITIVITY_RANK: Record<SensitivityLevel, number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  HIGHLY_CONFIDENTIAL: 3,
};

const ACTION_RANK: Record<ConceptAction, number> = {
  ALLOW_EXTERNAL: 0,
  MASK_AND_ALLOW_EXTERNAL: 1,
  ROUTE_LOCAL: 2,
  BLOCK: 3,
};

/**
 * Fuses deterministic hits, retrieved policy concepts, and semantic classifier evidence
 * into a single unified evidence payload according to strict action precedence.
 */
export function fuseEvidence(input: EvidenceFusionInput): FusedEvidence {
  const reasons: string[] = [];
  let pipelineHealth: FusedEvidence['pipelineHealth'] = 'HEALTHY';
  let hasCriticalConflict = false;

  // 1. Evaluate Pipeline Health & Degradation (spec §4.2 G)
  if (input.indexValid === false) {
    pipelineHealth = 'DEGRADED';
    reasons.push('ایندکس سیاست فعال نامعتبر یا قدیمی است (stale/missing index)');
  }

  if (input.deterministic.hadInternalError || input.deterministic.timedOut) {
    pipelineHealth = 'DEGRADED';
    reasons.push(
      input.deterministic.timedOut
        ? 'لایه تشخیص قطعی دچار مهلت زمانی شد'
        : 'خطای داخلی در اجرای دیتکتورهای قطعی',
    );
  }

  if (input.pipelineDegraded) {
    pipelineHealth = 'DEGRADED';
    if (input.degradationReason) {
      reasons.push(input.degradationReason);
    }
  }

  const semantic = input.semanticEvidence;
  if (!semantic || semantic.method === 'fallback') {
    pipelineHealth = 'DEGRADED';
    if (semantic?.reasonFa) {
      reasons.push(`قاضی محلی: ${semantic.reasonFa}`);
    }
  }

  // 2. Aggregate matched concepts
  const retrievedConcepts = input.retrievedConcepts ?? [];
  const conceptMap = new Map<string, PolicyConcept>();
  for (const rc of retrievedConcepts) {
    conceptMap.set(rc.concept.conceptKey, rc.concept);
  }

  const matchedConcepts: PolicyConcept[] = [];
  if (semantic && semantic.matchedConcepts.length > 0) {
    for (const key of semantic.matchedConcepts) {
      const found = conceptMap.get(key);
      if (found) {
        matchedConcepts.push(found);
      }
    }
  }

  // 3. Determine sensitivity and action from matched concepts
  let highestSensitivity: SensitivityLevel = 'PUBLIC';
  let precedenceAction: ConceptAction = 'ALLOW_EXTERNAL';

  for (const c of matchedConcepts) {
    if (SENSITIVITY_RANK[c.sensitivity] > SENSITIVITY_RANK[highestSensitivity]) {
      highestSensitivity = c.sensitivity;
    }
    if (ACTION_RANK[c.action] > ACTION_RANK[precedenceAction]) {
      precedenceAction = c.action;
    }
  }

  // 4. Integrate Deterministic Hits Precedence (Rule 7 & spec §4.2 B)
  const dlp = input.deterministic;
  if (dlp.hasAlwaysBlock) {
    precedenceAction = 'BLOCK';
    highestSensitivity = 'HIGHLY_CONFIDENTIAL';
    reasons.push('شناسایی تخلف امنیتی قطعی غیرقابل چشم‌پوشی (پلتفرم baseline BLOCK)');
  } else if (dlp.hasCriticalHit) {
    // Critical hit that is not always-block (e.g. National ID or Bank Card)
    if (ACTION_RANK['ROUTE_LOCAL'] > ACTION_RANK[precedenceAction]) {
      precedenceAction = 'ROUTE_LOCAL';
    }
    if (SENSITIVITY_RANK['CONFIDENTIAL'] > SENSITIVITY_RANK[highestSensitivity]) {
      highestSensitivity = 'CONFIDENTIAL';
    }
    reasons.push('شناسایی نشانگر قطعی حساس در پرامپت');
  }

  // 5. Conflict Resolution: Deterministic Critical vs Semantic SAFE
  if (dlp.hasCriticalHit && semantic?.decision === 'SAFE') {
    hasCriticalConflict = true;
    pipelineHealth = 'DEGRADED';
    reasons.push(
      'تعارض بحرانی شواهد: دیتکتور قطعی داده حساس بحرانی یافت اما مدل معنایی آن را امن اعلام کرد (حاکمیت دیتکتور قطعی طبق Rule 7)',
    );
  }

  // 6. Handle Semantic Classifier Decision
  const semanticDecision: SemanticDecision = semantic?.decision ?? 'UNCERTAIN';
  const semanticScope: SemanticScope = semantic?.scope ?? 'UNKNOWN';
  const semanticConfidence: number = semantic?.confidence ?? 0;

  if (semanticDecision === 'SENSITIVE') {
    // Only default to ROUTE_LOCAL and CONFIDENTIAL if no concept set explicit metadata
    if (matchedConcepts.length === 0) {
      if (ACTION_RANK['ROUTE_LOCAL'] > ACTION_RANK[precedenceAction]) {
        precedenceAction = 'ROUTE_LOCAL';
      }
      if (SENSITIVITY_RANK['CONFIDENTIAL'] > SENSITIVITY_RANK[highestSensitivity]) {
        highestSensitivity = 'CONFIDENTIAL';
      }
    }
    if (semantic?.reasonFa) {
      reasons.push(semantic.reasonFa);
    }
  } else if (semanticDecision === 'UNCERTAIN') {
    // Fail-closed rule: UNCERTAIN cannot go EXTERNAL_DIRECT
    if (ACTION_RANK['ROUTE_LOCAL'] > ACTION_RANK[precedenceAction]) {
      precedenceAction = 'ROUTE_LOCAL';
    }
    reasons.push(semantic?.reasonFa ?? 'ابهام در تحلیل معنایی پرامپت (fail-closed)');
  }

  return {
    pipelineHealth,
    deterministicHits: dlp.hits,
    matchedConcepts,
    highestSensitivity,
    precedenceAction,
    semanticDecision,
    semanticScope,
    semanticConfidence,
    hasCriticalConflict,
    reasons,
  };
}
