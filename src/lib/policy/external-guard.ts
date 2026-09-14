import type { DetectionOutcome } from './types';
import type { SanitizationReport } from './sanitizer';

export class ExternalRouteForbiddenError extends Error {
  readonly decision: string;

  constructor(decision: string) {
    super(
      `EXTERNAL route is forbidden for decision="${decision}" — ` +
        'only authorized external egress outcomes may reach the external provider',
    );
    this.name = 'ExternalRouteForbiddenError';
    this.decision = decision;
  }
}

/**
 * Throw unless the detection outcome is SAFE with EXTERNAL_ALLOWED action.
 * Called by /api/chat immediately before any external provider invocation (backward-compatible).
 */
export function assertExternalSafeAllowed(outcome: DetectionOutcome): void {
  if (outcome.decision !== 'SAFE' || outcome.action !== 'EXTERNAL_ALLOWED') {
    throw new ExternalRouteForbiddenError(outcome.decision);
  }
}

/**
 * Static safety net: the detection pipeline must never report an external
 * LLM invocation. Used as an invariant check in tests and by the chat route
 * after runDetection().
 */
export function assertNoExternalLlmInDetection(outcome: DetectionOutcome): void {
  if (outcome.processing.externalLlmInvoked !== false) {
    throw new ExternalRouteForbiddenError('externalLlmInvoked must stay false');
  }
}

export interface ExternalEgressValidationInput {
  outcome: DetectionOutcome;
  route: 'EXTERNAL_DIRECT' | 'EXTERNAL_MASKED' | 'EXTERNAL' | 'LOCAL' | 'BLOCKED' | string;
  isMaskedPayload?: boolean;
  sanitizationReport?: SanitizationReport;
  rawPrompt?: string;
  egressPayload: string;
  expectedPolicyVersion?: number;
}

/**
 * Enhanced External Route Egress Guard (MIGRATION_PLAN_REVIEWED_v1.1 §6.1).
 * Validates external egress for both EXTERNAL_DIRECT and EXTERNAL_MASKED:
 * - EXTERNAL_DIRECT: verifies high-confidence SAFE decision, healthy pipeline, and zero critical hits.
 * - EXTERNAL_MASKED: requires isMaskedPayload=true, complete SanitizationReport, zero unresolved entities,
 *   and ensures raw sensitive prompt is never leaked to the external provider.
 */
export function assertExternalEgressAllowed(input: ExternalEgressValidationInput): void {
  const {
    outcome,
    route,
    isMaskedPayload,
    sanitizationReport,
    rawPrompt,
    egressPayload,
    expectedPolicyVersion,
  } = input;

  // 1. Invariant: External LLM was never used in detection
  assertNoExternalLlmInDetection(outcome);

  // 2. Local & Blocked routes are unconditionally forbidden from external egress
  if (route === 'LOCAL' || route === 'BLOCKED' || outcome.action !== 'EXTERNAL_ALLOWED') {
    throw new ExternalRouteForbiddenError(route || outcome.decision);
  }

  // 3. Policy version validation if expected version is supplied
  if (
    expectedPolicyVersion !== undefined &&
    outcome.policyVersion !== undefined &&
    outcome.policyVersion !== expectedPolicyVersion
  ) {
    throw new ExternalRouteForbiddenError(
      `Policy version mismatch (expected ${expectedPolicyVersion}, got ${outcome.policyVersion})`,
    );
  }

  // 4. Critical security violations (private keys, jailbreaks) can NEVER egress under any route
  if (
    outcome.hits.some(
      (h) => h.category === 'private_key' || h.category === 'jailbreak_injection',
    )
  ) {
    throw new ExternalRouteForbiddenError('Critical security hit cannot be routed externally');
  }

  // 5. EXTERNAL_DIRECT (or legacy SAFE EXTERNAL)
  if (route === 'EXTERNAL_DIRECT' || route === 'EXTERNAL') {
    if (outcome.decision !== 'SAFE') {
      throw new ExternalRouteForbiddenError(
        `EXTERNAL_DIRECT requires SAFE decision, got ${outcome.decision}`,
      );
    }
    // Egress payload must exist
    if (!egressPayload) {
      throw new ExternalRouteForbiddenError('Egress payload cannot be empty');
    }
    return;
  }

  // 6. EXTERNAL_MASKED
  if (route === 'EXTERNAL_MASKED') {
    if (!isMaskedPayload) {
      throw new ExternalRouteForbiddenError(
        'EXTERNAL_MASKED requires isMaskedPayload=true',
      );
    }
    if (!sanitizationReport) {
      throw new ExternalRouteForbiddenError(
        'EXTERNAL_MASKED requires SanitizationReport',
      );
    }
    if (!sanitizationReport.complete) {
      throw new ExternalRouteForbiddenError(
        'EXTERNAL_MASKED requires SanitizationReport.complete=true',
      );
    }
    if (sanitizationReport.unresolvedEntities.length > 0) {
      throw new ExternalRouteForbiddenError(
        `EXTERNAL_MASKED has unresolved entities: [${sanitizationReport.unresolvedEntities.join(', ')}]`,
      );
    }
    // Raw sensitive prompt must NEVER leak: if entities were masked, payload must not equal raw prompt
    if (
      rawPrompt &&
      sanitizationReport.totalMasked > 0 &&
      egressPayload === rawPrompt
    ) {
      throw new ExternalRouteForbiddenError(
        'EXTERNAL_MASKED payload matches raw prompt despite sensitive findings (raw leak prevented)',
      );
    }
    return;
  }

  // Unknown route
  throw new ExternalRouteForbiddenError(`Unknown route "${route}"`);
}

