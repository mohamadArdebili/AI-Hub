// Chat routing guard tests — assertExternalSafeAllowed (prompt §3)
// SENSITIVE/UNCERTAIN must THROW; only SAFE may reach the external provider.

import { describe, it, expect } from 'vitest';
import {
  assertExternalSafeAllowed,
  assertNoExternalLlmInDetection,
  ExternalRouteForbiddenError,
} from '@/lib/policy/external-guard';
import type { DetectionOutcome } from '@/lib/policy/types';

const HASH = 'b'.repeat(64);

function outcome(
  decision: 'SAFE' | 'SENSITIVE' | 'UNCERTAIN',
  externalLlmInvoked: false = false,
): DetectionOutcome {
  return {
    decision,
    action: decision === 'SAFE' ? 'EXTERNAL_ALLOWED' : 'LOCAL_ONLY',
    hits: [],
    processing: {
      normalizedInputHash: HASH,
      durationMs: 1,
      localLlmUsed: false,
      externalLlmInvoked,
    },
  };
}

describe('assertExternalSafeAllowed', () => {
  it('allows the external route for a high-confidence SAFE outcome', () => {
    expect(() => assertExternalSafeAllowed(outcome('SAFE'))).not.toThrow();
  });

  it('THROWS ExternalRouteForbiddenError for SENSITIVE', () => {
    try {
      assertExternalSafeAllowed(outcome('SENSITIVE'));
      expect.unreachable('guard must throw for SENSITIVE');
    } catch (err) {
      expect(err).toBeInstanceOf(ExternalRouteForbiddenError);
      expect((err as ExternalRouteForbiddenError).decision).toBe('SENSITIVE');
    }
  });

  it('THROWS ExternalRouteForbiddenError for UNCERTAIN (fail-closed)', () => {
    try {
      assertExternalSafeAllowed(outcome('UNCERTAIN'));
      expect.unreachable('guard must throw for UNCERTAIN');
    } catch (err) {
      expect(err).toBeInstanceOf(ExternalRouteForbiddenError);
      expect((err as ExternalRouteForbiddenError).decision).toBe('UNCERTAIN');
    }
  });
});

describe('assertNoExternalLlmInDetection', () => {
  it('passes when externalLlmInvoked stays false', () => {
    expect(() => assertNoExternalLlmInDetection(outcome('SAFE'))).not.toThrow();
  });

  it('THROWS if the pipeline ever reports an external LLM invocation', () => {
    // Deliberate contract violation — bypass the literal-false type via cast.
    const bad = outcome('SAFE', true as unknown as false);
    expect(() => assertNoExternalLlmInDetection(bad)).toThrow(
      ExternalRouteForbiddenError,
    );
  });
});
