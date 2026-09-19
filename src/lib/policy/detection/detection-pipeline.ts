// V2 Runtime Detection Pipeline — Hybrid Retrieval & Local Semantic Classifier
// (MIGRATION_PLAN_REVIEWED_v1.1 §5.4, spec §57, Rule 7, Rule 18)

import crypto from 'crypto';
import { withinDeadline } from './deadline';
import { normalizePersian } from '../normalize';
import { runDeterministicDlp, type DeterministicHit } from './deterministic-dlp';
import { fuseEvidence } from './evidence-fusion';
import { decidePolicyRoute, type PolicyRoute } from './decision-engine';
import { HybridRetriever } from '../retrieval/hybrid-retriever';
import {
  OllamaSemanticPolicyClassifier,
  type PolicySemanticClassifier,
} from '../local-llm/semantic-classifier';
import type { CompiledPolicyRule, DetectionOutcome } from '../types';
import type { RetrievedConcept } from '../concepts/types';

export interface StageLatencies {
  normalizationMs: number;
  dlpMs: number;
  retrievalMs: number;
  classifierMs: number;
  fusionMs: number;
  decisionMs: number;
  totalMs: number;
}

export interface DetectionV2Input {
  prompt: string;
  messages?: Array<{ role: 'user' | 'system' | 'assistant'; content: string }>;
  organizationId: string;
  compiledRules?: CompiledPolicyRule[];
  dictionaries?: {
    seniorOfficers?: string[];
    telcoHubNodes?: string[];
    proprietaryServices?: string[];
  };
  sourceRef?: { documentId: string; page?: number };
  classifier?: PolicySemanticClassifier;
  hybridRetriever?: HybridRetriever;
  timeoutBudgetMs?: number;
  minClassifierConfidence?: number;
  activePolicyVersion?: number;
  documentId?: string;
}

export interface DetectionV2Result {
  outcome: DetectionOutcome;
  route: PolicyRoute;
  stageLatencies: StageLatencies;
}

/**
 * Runs the complete V2 Detection Pipeline (Normalization -> DLP -> Hybrid Retrieval ->
 * Semantic Classifier -> Evidence Fusion -> Action-Aware Decision Engine).
 *
 * Enforces strict deadline budgeting across all internal stages. Never throws.
 */
export async function runDetectionV2(input: DetectionV2Input): Promise<DetectionOutcome> {
  const startedAt = Date.now();
  const timeoutBudgetMs =
    input.timeoutBudgetMs ??
    parseInt(process.env.POLICY_DETECTION_TIMEOUT_MS ?? '10000', 10);
  const deadline = startedAt + timeoutBudgetMs;

  const latencies: StageLatencies = {
    normalizationMs: 0,
    dlpMs: 0,
    retrievalMs: 0,
    classifierMs: 0,
    fusionMs: 0,
    decisionMs: 0,
    totalMs: 0,
  };

  let normalizedPrompt = '';
  let normalizedInputHash = '';

  try {
    if (!Number.isFinite(timeoutBudgetMs) || timeoutBudgetMs <= 0 || input.prompt.length > 24000) {
      throw new Error('INVALID_BUDGET_OR_CONTEXT_TOO_LARGE');
    }
    // ── Stage 1: Persian Normalization ─────────────────────────────────────
    const normStart = Date.now();
    normalizedPrompt = normalizePersian(input.prompt);
    normalizedInputHash = crypto
      .createHash('sha256')
      .update(normalizedPrompt)
      .digest('hex');
    latencies.normalizationMs = Date.now() - normStart;

    // ── Stage 2: Deterministic DLP ─────────────────────────────────────────
    const dlpStart = Date.now();
    const dlpResult = runDeterministicDlp(
      {
        prompt: input.messages?.map(m => m.content).join('\n') ?? input.prompt,
        normalizedPrompt: normalizePersian(input.messages?.map(m => m.content).join('\n') ?? input.prompt),
        compiledRules: input.compiledRules,
        dictionaries: input.dictionaries,
        sourceRef: input.sourceRef,
      },
      { deadline },
    );
    latencies.dlpMs = Date.now() - dlpStart;

    // Short-circuit optimization: If a non-negotiable platform baseline BLOCK occurs
    // (e.g. private key, cloud credential, confirmed jailbreak), immediately decide BLOCK.
    if (dlpResult.hasAlwaysBlock) {
      const fused = fuseEvidence({ deterministic: dlpResult });
      const decisionResult = decidePolicyRoute({
        fusedEvidence: fused,
        normalizedInputHash,
        durationMs: Date.now() - startedAt,
        policyVersion: input.activePolicyVersion,
        minClassifierConfidence: input.minClassifierConfidence,
      });

      latencies.totalMs = Date.now() - startedAt;
      return {
        ...decisionResult.outcome,
        stageLatencies: latencies,
      };
    }

    // Check remaining deadline
    let remainingBudget = deadline - Date.now();
    if (remainingBudget <= 0) {
      return buildFailClosedOutcome({
        prompt: input.prompt,
        normalizedInputHash,
        hits: dlpResult.hits,
        startedAt,
        latencies,
        reason: 'مهلت زمانی پایپ‌لاین تشخیص پیش از بازیابی معنایی پایان یافت (fail-closed)',
      });
    }

    // ── Stage 3: Hybrid Retrieval (Dense + BM25 Lexical + RRF) ─────────────
    const retStart = Date.now();
    const retriever = input.hybridRetriever ?? new HybridRetriever();
    let retrievedConcepts: RetrievedConcept[] = [];
    let retrievalError: Error | null = null;

    try {
      retrievedConcepts = await withinDeadline(retriever.retrieve(normalizedPrompt, {
        organizationId: input.organizationId,
        documentId: input.documentId,
        topK: 5,
      }), deadline);
      if (retrievedConcepts.length === 0) throw new Error('NO_POLICY_COVERAGE');
    } catch (err) {
      retrievalError = err instanceof Error ? err : new Error(String(err));
      console.warn('[detection-pipeline-v2] hybrid retrieval warning:', retrievalError.message);
    }
    latencies.retrievalMs = Date.now() - retStart;

    // ── Stage 4: Local LLM Semantic Policy Classifier ──────────────────────
    const classStart = Date.now();
    remainingBudget = deadline - Date.now();
    const classifier = input.classifier ?? new OllamaSemanticPolicyClassifier();

    let semanticEvidence;
    if (remainingBudget <= 100) {
      semanticEvidence = {
        decision: 'UNCERTAIN' as const,
        scope: 'UNKNOWN' as const,
        matchedConcepts: [],
        confidence: 0,
        reasonFa: 'مهلت زمانی برای فراخوانی مدل محلی ناکافی بود (fail-closed)',
        method: 'fallback' as const,
        modelUsed: 'none',
        latencyMs: 0,
        error: 'DEADLINE_EXCEEDED',
      };
    } else {
      semanticEvidence = await withinDeadline(classifier.classify({
        prompt: input.prompt, // Raw prompt per spec §65
        candidateConcepts: retrievedConcepts,
        timeoutMs: remainingBudget,
      }), deadline);
    }
    latencies.classifierMs = Date.now() - classStart;

    // ── Stage 5: Evidence Fusion ───────────────────────────────────────────
    const fusionStart = Date.now();
    const fusedEvidence = fuseEvidence({
      deterministic: dlpResult,
      retrievedConcepts,
      semanticEvidence,
      pipelineDegraded: retrievalError !== null,
      degradationReason: retrievalError ? `خطا در بازیابی مفاهیم: ${retrievalError.message}` : undefined,
      policyVersion: input.activePolicyVersion,
    });
    latencies.fusionMs = Date.now() - fusionStart;

    // ── Stage 6: Action-Aware Decision Engine ──────────────────────────────
    const decStart = Date.now();
    const decisionResult = decidePolicyRoute({
      fusedEvidence,
      normalizedInputHash,
      durationMs: Date.now() - startedAt,
      policyVersion: input.activePolicyVersion,
      minClassifierConfidence: input.minClassifierConfidence,
    });
    latencies.decisionMs = Date.now() - decStart;
    latencies.totalMs = Date.now() - startedAt;

    return {
      ...decisionResult.outcome,
      retrievedConcepts: retrievedConcepts.map((r) => ({
        conceptId: r.concept.id,
        conceptKey: r.concept.conceptKey,
        name: r.concept.name,
        category: r.concept.category ?? r.concept.sectionTitle ?? r.concept.nameFa ?? r.concept.name,
        sensitivity: r.concept.sensitivity,
        action: r.concept.action,
        score: r.score,
        denseScore: r.denseScore,
        lexicalScore: r.lexicalScore,
        rrfScore: r.rrfScore,
      })),
      classifier: {
        method: fusedEvidence.pipelineHealth === 'HEALTHY' ? 'local_llm' : 'fallback',
        confidence: fusedEvidence.semanticConfidence,
        reason: decisionResult.outcome.reason,
        reasonFa: semanticEvidence?.reasonFa,
        modelUsed: semanticEvidence?.modelUsed,
        scope: semanticEvidence?.scope,
        decision: semanticEvidence?.decision,
      },
      stageLatencies: latencies,
    };
  } catch (err) {
    // Top-level fail-closed catch-all (spec §4.2 G)
    console.error('[detection-pipeline-v2] unexpected error in detection:', err);
    latencies.totalMs = Date.now() - startedAt;

    return buildFailClosedOutcome({
      prompt: input.prompt,
      normalizedInputHash: normalizedInputHash || crypto.createHash('sha256').update(input.prompt).digest('hex'),
      hits: [],
      startedAt,
      latencies,
      reason: 'خطای غیرمنتظره در پردازش پایپ‌لاین تشخیص — ارجاع به مسیر امن محلی (fail-closed)',
    });
  }
}

function buildFailClosedOutcome(params: {
  prompt: string;
  normalizedInputHash: string;
  hits: DeterministicHit[];
  startedAt: number;
  latencies: StageLatencies;
  reason: string;
}): DetectionOutcome {
  return {
    decision: 'UNCERTAIN',
    action: 'LOCAL_ONLY',
    hits: params.hits,
    processing: {
      normalizedInputHash: params.normalizedInputHash,
      durationMs: Date.now() - params.startedAt,
      localLlmUsed: true,
      externalLlmInvoked: false,
    },
    reason: params.reason,
    route: 'LOCAL',
    pipelineHealth: 'FAILED',
    stageLatencies: params.latencies,
  };
}
