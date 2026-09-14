// Runtime Detection Pipeline — Sensitive-Data Layer (prompt §1.4).
//
// Order is contractual and enforced here:
//   1. normalize        (Persian/Arabic digits, ZWNJ, spacing, NFKC)
//   2. deterministic    (checksum → builtin regex/secrets → dictionary →
//                        compiled REGEX/DICTIONARY policy rules)
//   3. semantic         (compiled SEMANTIC keyword rules + builtin
//                        jailbreak scan — deterministic, no LLM)
//   4. classify         (classifyDetection → SAFE | SENSITIVE | UNCERTAIN)
//
// Hard rules enforced by this module:
//   - NO external LLM is ever invoked (externalLlmInvoked stays false).
//   - Any internal detector error or timeout → fail-closed UNCERTAIN.
//   - Logs contain hashes/labels only — never raw sensitive content.

import { normalizePersian } from './normalize';
import {
  detectBankCardHits,
  detectBulkContactHits,
  detectCompiledRuleHits,
  detectDictionaryHits,
  detectIbanHits,
  detectJailbreakHits,
  detectNationalIdHits,
  detectSecretHits,
} from './detectors';
import { classifyDetection } from './classifier';
import type {
  CompiledPolicyRule,
  DetectionHit,
  DetectionOutcome,
} from './types';
import crypto from 'crypto';
import { validatePolicyConfig } from './config-validator';
import { runDetectionV2, type DetectionV2Input } from './detection/detection-pipeline';
import type { PolicySemanticClassifier } from './local-llm/semantic-classifier';
import type { HybridRetriever } from './retrieval/hybrid-retriever';

export { runDetectionV2 };

export interface RunDetectionInput {
  prompt: string;
  compiledRules: CompiledPolicyRule[];
  dictionaries: {
    seniorOfficers: string[];
    telcoHubNodes: string[];
    proprietaryServices: string[];
  };
  sourceRef?: { documentId: string; page?: number };
  organizationId?: string;
  classifier?: PolicySemanticClassifier;
  hybridRetriever?: HybridRetriever;
  timeoutBudgetMs?: number;
  activePolicyVersion?: number;
}

/**
 * Run the detection pipeline over a user prompt and return the
 * SAFE/SENSITIVE/UNCERTAIN outcome.
 * When POLICY_SEMANTIC_ENABLED is 'true', runs the V2 hybrid retrieval & semantic classifier pipeline.
 * Otherwise, falls back to the deterministic pipeline for complete backwards compatibility.
 * Never throws — internal errors are converted to a fail-closed UNCERTAIN outcome.
 */
export async function runDetection(input: RunDetectionInput): Promise<DetectionOutcome> {
  const isSemanticEnabled = process.env.POLICY_SEMANTIC_ENABLED !== 'false';
  if (isSemanticEnabled && input.organizationId) {
    return runDetectionV2({
      prompt: input.prompt,
      organizationId: input.organizationId,
      compiledRules: input.compiledRules,
      dictionaries: input.dictionaries,
      sourceRef: input.sourceRef,
      classifier: input.classifier,
      hybridRetriever: input.hybridRetriever,
      timeoutBudgetMs: input.timeoutBudgetMs,
      activePolicyVersion: input.activePolicyVersion,
    });
  }

  const startedAt = Date.now();

  try {
    const configValidation = validatePolicyConfig();
    if (!configValidation.valid) {
      console.error(
        '[detection-pipeline] invalid timeout configuration:',
        configValidation.errors.join('; '),
      );
      return {
        decision: 'UNCERTAIN',
        action: 'LOCAL_ONLY',
        hits: [],
        processing: {
          normalizedInputHash: crypto
            .createHash('sha256')
            .update(normalizePersian(input.prompt))
            .digest('hex'),
          durationMs: Date.now() - startedAt,
          localLlmUsed: false,
          externalLlmInvoked: false,
        },
        reason: 'پیکربندی مهلت زمانی سیستم نامعتبر است — تصمیم امن محلی اعمال شد',
      };
    }

    const deadline = startedAt + configValidation.config.detectionTimeoutMs;

    // ── 1. normalize ────────────────────────────────────────────────────────
    const normalized = normalizePersian(input.prompt);
    const ctx = { original: input.prompt, normalized };
    const normalizedInputHash = crypto
      .createHash('sha256')
      .update(normalized)
      .digest('hex');

    const hits: DetectionHit[] = [];
    let hadInternalError = false;

    // Per-detector isolation: one failing detector must not crash the
    // pipeline — it flips the outcome to fail-closed UNCERTAIN instead.
    const runStep = (name: string, fn: () => DetectionHit[]): void => {
      if (Date.now() > deadline) {
        hadInternalError = true; // treated as timeout below
        return;
      }
      try {
        hits.push(...fn());
      } catch (err) {
        hadInternalError = true;
        console.error(
          `[detection-pipeline] detector "${name}" failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    };

    // ── 2. deterministic detectors ─────────────────────────────────────────
    runStep('checksum:national_id', () => detectNationalIdHits(ctx));
    runStep('checksum:bank_card', () => detectBankCardHits(ctx));
    runStep('checksum:iban', () => detectIbanHits(ctx));
    runStep('regex:secrets', () => detectSecretHits(ctx));
    runStep('regex:bulk_contact', () => detectBulkContactHits(ctx));
    runStep('dictionary:mask_dictionary', () =>
      detectDictionaryHits(ctx, input.dictionaries, input.sourceRef),
    );

    const compiledRegexDict = input.compiledRules.filter(
      (r) => r.detectorType === 'REGEX' || r.detectorType === 'DICTIONARY',
    );
    runStep('compiled:regex_dictionary', () =>
      detectCompiledRuleHits(ctx, compiledRegexDict),
    );

    // ── 3. semantic (deterministic keyword rules — no LLM) ─────────────────
    const compiledSemantic = input.compiledRules.filter(
      (r) => r.detectorType === 'SEMANTIC',
    );
    runStep('compiled:semantic', () => detectCompiledRuleHits(ctx, compiledSemantic));
    runStep('semantic:jailbreak', () => detectJailbreakHits(ctx));

    const timedOut = Date.now() > deadline;

    // ── 4. classify ────────────────────────────────────────────────────────
    const outcome = classifyDetection({
      hits,
      hadInternalError,
      timedOut,
      normalizedInputHash,
      durationMs: Date.now() - startedAt,
    });

    if (outcome.processing.externalLlmInvoked !== false) {
      // Contractual invariant — never true by construction.
      throw new Error('detection pipeline must never invoke an external LLM');
    }
    return outcome;
  } catch (err) {
    // Absolute fail-closed: pipeline-level crash → UNCERTAIN.
    console.error(
      '[detection-pipeline] fatal error:',
      err instanceof Error ? err.message : err,
    );
    return {
      decision: 'UNCERTAIN',
      action: 'LOCAL_ONLY',
      hits: [],
      processing: {
        normalizedInputHash: crypto
          .createHash('sha256')
          .update(normalizePersian(input.prompt))
          .digest('hex'),
        durationMs: Date.now() - startedAt,
        localLlmUsed: false,
        externalLlmInvoked: false,
      },
      reason: 'خطای داخلی در لایه تشخیص — تصمیم امن محلی اعمال شد',
    };
  }
}
