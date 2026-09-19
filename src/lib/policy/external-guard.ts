import crypto from 'crypto';
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

/** Only a healthy, high-confidence SAFE decision authorizes unchanged external egress.
 * Masked external sending remains disabled in this phase.
 */
export function assertExternalEgressAllowed(input: ExternalEgressValidationInput): void {
  const {
    outcome,
    route,
    egressPayload,
    expectedPolicyVersion,
  } = input;

  // 1. Invariant: External LLM was never used in detection
  assertNoExternalLlmInDetection(outcome);

  // 2. Local & Blocked routes are unconditionally forbidden from external egress
  if (route === 'LOCAL' || route === 'BLOCKED' || outcome.action !== 'EXTERNAL_ALLOWED') {
    throw new ExternalRouteForbiddenError(route || outcome.decision);
  }

  if (outcome.route && outcome.route !== route && route !== 'EXTERNAL') {
    throw new ExternalRouteForbiddenError('Route contradicts detection outcome');
  }

  // 3. Policy version validation if expected version is supplied
  if (
    expectedPolicyVersion !== undefined &&
    outcome.policyVersion !== expectedPolicyVersion
  ) {
    throw new ExternalRouteForbiddenError(
      `Policy version mismatch (expected ${expectedPolicyVersion}, got ${outcome.policyVersion})`,
    );
  }

  if (outcome.processing.egressPayloadHash && crypto.createHash('sha256').update(egressPayload).digest('hex') !== outcome.processing.egressPayloadHash) {
    throw new ExternalRouteForbiddenError('Payload changed after detection');
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
    if (outcome.decision !== 'SAFE' || outcome.pipelineHealth !== 'HEALTHY' ||
        outcome.classifier?.scope !== 'GENERAL' || (outcome.classifier?.confidence ?? 0) < 0.7 || outcome.hits.length > 0) {
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

  // Masking alone cannot authorize external sending in this phase.
  if (route === 'EXTERNAL_MASKED') throw new ExternalRouteForbiddenError('Masked egress is disabled');

  // Unknown route
  throw new ExternalRouteForbiddenError(`Unknown route "${route}"`);
}

