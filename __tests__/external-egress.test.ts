import { describe, it, expect } from 'vitest';
import {
  assertExternalEgressAllowed,
  assertExternalSafeAllowed,
  ExternalRouteForbiddenError,
} from '@/lib/policy/external-guard';
import type { DetectionOutcome } from '@/lib/policy/types';
import type { SanitizationReport } from '@/lib/policy/sanitizer';

function createOutcome(overrides: Partial<DetectionOutcome> = {}): DetectionOutcome {
  return {
    decision: 'SAFE',
    action: 'EXTERNAL_ALLOWED',
    hits: [],
    processing: {
      normalizedInputHash: '0'.repeat(64),
      durationMs: 5,
      localLlmUsed: true,
      externalLlmInvoked: false,
    },
    route: 'EXTERNAL_DIRECT',
    ...overrides,
  };
}

describe('assertExternalEgressAllowed (Phase 6 External Guard)', () => {
  const completeReport: SanitizationReport = {
    complete: true,
    totalMasked: 2,
    findings: [{ label: 'NATIONAL_ID', count: 2 }],
    unresolvedEntities: [],
    maskedText: 'شماره ملی کاربر: [NATIONAL_ID]',
  };

  it('allows EXTERNAL_DIRECT for SAFE outcome', () => {
    const outcome = createOutcome({ decision: 'SAFE', route: 'EXTERNAL_DIRECT' });
    expect(() =>
      assertExternalEgressAllowed({
        outcome,
        route: 'EXTERNAL_DIRECT',
        rawPrompt: 'پایتون چیست؟',
        egressPayload: 'پایتون چیست؟',
      }),
    ).not.toThrow();
  });

  it('forbids EXTERNAL_DIRECT when decision is SENSITIVE', () => {
    const outcome = createOutcome({ decision: 'SENSITIVE', route: 'EXTERNAL_DIRECT' });
    expect(() =>
      assertExternalEgressAllowed({
        outcome,
        route: 'EXTERNAL_DIRECT',
        egressPayload: 'تست',
      }),
    ).toThrow(ExternalRouteForbiddenError);
  });

  it('forbids EXTERNAL_DIRECT if critical security hit is present', () => {
    const outcome = createOutcome({
      decision: 'SAFE',
      route: 'EXTERNAL_DIRECT',
      hits: [
        {
          category: 'private_key',
          confidence: 1.0,
          detectorType: 'REGEX',
          ruleId: null,
          matchedSpan: { start: 0, end: 10, text: 'PRIVATE KEY' },
        },
      ],
    });
    expect(() =>
      assertExternalEgressAllowed({
        outcome,
        route: 'EXTERNAL_DIRECT',
        egressPayload: 'PRIVATE KEY',
      }),
    ).toThrow(/Critical security hit/);
  });

  it('allows EXTERNAL_MASKED with valid complete sanitization report', () => {
    const outcome = createOutcome({
      decision: 'SENSITIVE',
      action: 'EXTERNAL_ALLOWED',
      route: 'EXTERNAL_MASKED',
    });
    expect(() =>
      assertExternalEgressAllowed({
        outcome,
        route: 'EXTERNAL_MASKED',
        isMaskedPayload: true,
        sanitizationReport: completeReport,
        rawPrompt: 'شماره ملی کاربر: 0012345678',
        egressPayload: completeReport.maskedText,
      }),
    ).not.toThrow();
  });

  it('forbids EXTERNAL_MASKED if isMaskedPayload is false', () => {
    const outcome = createOutcome({
      decision: 'SENSITIVE',
      action: 'EXTERNAL_ALLOWED',
      route: 'EXTERNAL_MASKED',
    });
    expect(() =>
      assertExternalEgressAllowed({
        outcome,
        route: 'EXTERNAL_MASKED',
        isMaskedPayload: false,
        sanitizationReport: completeReport,
        egressPayload: completeReport.maskedText,
      }),
    ).toThrow(/requires isMaskedPayload=true/);
  });

  it('forbids EXTERNAL_MASKED if sanitization report is incomplete', () => {
    const outcome = createOutcome({
      decision: 'SENSITIVE',
      action: 'EXTERNAL_ALLOWED',
      route: 'EXTERNAL_MASKED',
    });
    const incompleteReport: SanitizationReport = {
      ...completeReport,
      complete: false,
      unresolvedEntities: ['UNRESOLVED_REQ_NATIONAL_ID'],
    };
    expect(() =>
      assertExternalEgressAllowed({
        outcome,
        route: 'EXTERNAL_MASKED',
        isMaskedPayload: true,
        sanitizationReport: incompleteReport,
        egressPayload: completeReport.maskedText,
      }),
    ).toThrow(/requires SanitizationReport.complete=true/);
  });

  it('prevents raw sensitive prompt leak when masked payload equals raw prompt', () => {
    const outcome = createOutcome({
      decision: 'SENSITIVE',
      action: 'EXTERNAL_ALLOWED',
      route: 'EXTERNAL_MASKED',
    });
    expect(() =>
      assertExternalEgressAllowed({
        outcome,
        route: 'EXTERNAL_MASKED',
        isMaskedPayload: true,
        sanitizationReport: completeReport,
        rawPrompt: 'raw sensitive text',
        egressPayload: 'raw sensitive text', // LEAK ATTEMPT!
      }),
    ).toThrow(/raw leak prevented/);
  });

  it('forbids external egress unconditionally for LOCAL and BLOCKED routes', () => {
    const localOutcome = createOutcome({
      decision: 'SENSITIVE',
      action: 'LOCAL_ONLY',
      route: 'LOCAL',
    });
    expect(() =>
      assertExternalEgressAllowed({
        outcome: localOutcome,
        route: 'LOCAL',
        egressPayload: 'test',
      }),
    ).toThrow(ExternalRouteForbiddenError);

    const blockedOutcome = createOutcome({
      decision: 'SENSITIVE',
      action: 'LOCAL_ONLY',
      route: 'BLOCKED',
    });
    expect(() =>
      assertExternalEgressAllowed({
        outcome: blockedOutcome,
        route: 'BLOCKED',
        egressPayload: 'test',
      }),
    ).toThrow(ExternalRouteForbiddenError);
  });

  it('forbids egress when policy version mismatches', () => {
    const outcome = createOutcome({
      decision: 'SAFE',
      route: 'EXTERNAL_DIRECT',
      policyVersion: 2,
    });
    expect(() =>
      assertExternalEgressAllowed({
        outcome,
        route: 'EXTERNAL_DIRECT',
        egressPayload: 'safe prompt',
        expectedPolicyVersion: 3,
      }),
    ).toThrow(/Policy version mismatch/);
  });

  it('forbids egress if externalLlmInvoked was true during detection', () => {
    const badOutcome = createOutcome({
      decision: 'SAFE',
      route: 'EXTERNAL_DIRECT',
      processing: {
        normalizedInputHash: '0'.repeat(64),
        durationMs: 1,
        localLlmUsed: true,
        externalLlmInvoked: true as unknown as false,
      },
    });
    expect(() =>
      assertExternalEgressAllowed({
        outcome: badOutcome,
        route: 'EXTERNAL_DIRECT',
        egressPayload: 'safe',
      }),
    ).toThrow(/externalLlmInvoked must stay false/);
  });
});
