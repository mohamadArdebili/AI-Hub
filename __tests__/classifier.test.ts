// Deterministic classifier tests — SAFE / SENSITIVE / UNCERTAIN (prompt §3)
// The external-LLM classifier is FORBIDDEN in the detection path; these tests
// pin the pure deterministic mapping, including the fail-closed behavior.

import { describe, it, expect } from 'vitest';
import {
  classifyDetection,
  isCriticalHitSet,
  SENSITIVE_THRESHOLD,
} from '@/lib/policy/classifier';
import type { DetectionHit } from '@/lib/policy/types';

const HASH = 'a'.repeat(64);

function hit(overrides: Partial<DetectionHit> = {}): DetectionHit {
  return {
    detectorType: 'CHECKSUM',
    ruleId: null,
    ruleLabel: 'کد ملی',
    matchedSpan: { start: 0, end: 10, text: '0012523721' },
    confidence: 0.95,
    category: 'national_id',
    ...overrides,
  };
}

describe('classifyDetection — SAFE', () => {
  it('returns SAFE + EXTERNAL_ALLOWED when there are no hits', () => {
    const out = classifyDetection({ hits: [], normalizedInputHash: HASH, durationMs: 5 });
    expect(out.decision).toBe('SAFE');
    expect(out.action).toBe('EXTERNAL_ALLOWED');
    expect(out.processing.externalLlmInvoked).toBe(false);
    expect(out.processing.localLlmUsed).toBe(false);
  });
});

describe('classifyDetection — SENSITIVE', () => {
  it('returns SENSITIVE + LOCAL_ONLY for a high-confidence hit', () => {
    const out = classifyDetection({
      hits: [hit()],
      normalizedInputHash: HASH,
      durationMs: 5,
    });
    expect(out.decision).toBe('SENSITIVE');
    expect(out.action).toBe('LOCAL_ONLY');
  });

  it('returns SENSITIVE when the best hit is exactly at the threshold', () => {
    const out = classifyDetection({
      hits: [hit({ confidence: SENSITIVE_THRESHOLD })],
      normalizedInputHash: HASH,
      durationMs: 5,
    });
    expect(out.decision).toBe('SENSITIVE');
  });
});

describe('classifyDetection — UNCERTAIN (fail-closed)', () => {
  it('maps low-confidence hits to UNCERTAIN + LOCAL_ONLY', () => {
    const out = classifyDetection({
      hits: [hit({ confidence: 0.6, category: 'policy_semantic' })],
      normalizedInputHash: HASH,
      durationMs: 5,
    });
    expect(out.decision).toBe('UNCERTAIN');
    expect(out.action).toBe('LOCAL_ONLY');
  });

  it('forces UNCERTAIN on internal detector error — even with no hits', () => {
    const out = classifyDetection({
      hits: [],
      hadInternalError: true,
      normalizedInputHash: HASH,
      durationMs: 5,
    });
    expect(out.decision).toBe('UNCERTAIN');
    expect(out.action).toBe('LOCAL_ONLY');
  });

  it('forces UNCERTAIN on timeout — never external', () => {
    const out = classifyDetection({
      hits: [],
      timedOut: true,
      normalizedInputHash: HASH,
      durationMs: 3001,
    });
    expect(out.decision).toBe('UNCERTAIN');
    expect(out.action).toBe('LOCAL_ONLY');
  });

  it('drops sub-noise hits (< 0.5) completely → SAFE', () => {
    const out = classifyDetection({
      hits: [hit({ confidence: 0.3 })],
      normalizedInputHash: HASH,
      durationMs: 5,
    });
    expect(out.decision).toBe('SAFE');
    expect(out.hits).toHaveLength(0);
  });
});

describe('isCriticalHitSet', () => {
  it('marks national_id / iban / jailbreak categories as critical', () => {
    expect(isCriticalHitSet([hit({ category: 'national_id' })])).toBe(true);
    expect(isCriticalHitSet([hit({ category: 'iban' })])).toBe(true);
    expect(isCriticalHitSet([hit({ category: 'jailbreak_injection' })])).toBe(true);
  });

  it('treats compiled BLOCK_EXTERNAL rules as critical', () => {
    const ruleActions = new Map([['rule-9', 'BLOCK_EXTERNAL']]);
    expect(
      isCriticalHitSet([hit({ category: 'policy_semantic', ruleId: 'rule-9' })], ruleActions),
    ).toBe(true);
  });

  it('does not mark bulk contact / dictionary hits as critical', () => {
    expect(isCriticalHitSet([hit({ category: 'bulk_email', confidence: 0.8 })])).toBe(false);
    expect(isCriticalHitSet([hit({ category: 'senior_officer' })])).toBe(false);
  });
});
