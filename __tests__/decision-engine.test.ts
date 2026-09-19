// Unit tests for Action-Aware Decision Engine
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 5, §5.3, spec §4.2, Rule 18)

import { describe, it, expect } from 'vitest';
import { decidePolicyRoute, type DecisionEngineInput } from '@/lib/policy/detection/decision-engine';
import type { FusedEvidence } from '@/lib/policy/detection/evidence-fusion';

describe('Action-Aware Decision Engine', () => {
  const baseFusedEvidence: FusedEvidence = {
    pipelineHealth: 'HEALTHY',
    deterministicHits: [],
    matchedConcepts: [],
    highestSensitivity: 'PUBLIC',
    precedenceAction: 'ALLOW_EXTERNAL',
    semanticDecision: 'SAFE',
    semanticScope: 'GENERAL',
    semanticConfidence: 0.95,
    hasCriticalConflict: false,
    reasons: ['درخواست دانش عمومی'],
  };

  it('routes clean, high-confidence, healthy general queries to EXTERNAL_DIRECT', () => {
    const input: DecisionEngineInput = {
      fusedEvidence: baseFusedEvidence,
      normalizedInputHash: 'hash-123',
      durationMs: 50,
      policyVersion: 1,
    };

    const res = decidePolicyRoute(input);
    expect(res.route).toBe('EXTERNAL_DIRECT');
    expect(res.decision).toBe('SAFE');
    expect(res.action).toBe('EXTERNAL_ALLOWED');
    expect(res.outcome.route).toBe('EXTERNAL_DIRECT');
    expect(res.outcome.processing.externalLlmInvoked).toBe(false);
  });

  it('routes to BLOCKED when precedenceAction is BLOCK', () => {
    const input: DecisionEngineInput = {
      fusedEvidence: {
        ...baseFusedEvidence,
        precedenceAction: 'BLOCK',
        highestSensitivity: 'HIGHLY_CONFIDENTIAL',
        semanticDecision: 'SENSITIVE',
        reasons: ['نقض کلید خصوصی'],
      },
      normalizedInputHash: 'hash-block',
      durationMs: 10,
    };

    const res = decidePolicyRoute(input);
    expect(res.route).toBe('BLOCKED');
    expect(res.decision).toBe('SENSITIVE');
    expect(res.action).toBe('LOCAL_ONLY');
    expect(res.outcome.route).toBe('BLOCKED');
  });

  it('routes masked policy actions locally in this phase', () => {
    const input: DecisionEngineInput = {
      fusedEvidence: {
        ...baseFusedEvidence,
        precedenceAction: 'MASK_AND_ALLOW_EXTERNAL',
        highestSensitivity: 'INTERNAL',
        semanticDecision: 'SENSITIVE',
        reasons: ['ماسک‌گذاری شماره پشتیبانی'],
      },
      normalizedInputHash: 'hash-mask',
      durationMs: 25,
    };

    const res = decidePolicyRoute(input);
    expect(res.route).toBe('LOCAL');
    expect(res.decision).toBe('SENSITIVE');
    expect(res.action).toBe('LOCAL_ONLY');
    expect(res.outcome.route).toBe('LOCAL');
  });

  it('routes strictly to LOCAL on UNCERTAIN, degraded health, unknown scope, or low confidence (fail-closed)', () => {
    // 1. UNCERTAIN
    const resUncertain = decidePolicyRoute({
      fusedEvidence: {
        ...baseFusedEvidence,
        semanticDecision: 'UNCERTAIN',
        reasons: ['ابهام'],
      },
      normalizedInputHash: 'h1',
      durationMs: 20,
    });
    expect(resUncertain.route).toBe('LOCAL');
    expect(resUncertain.action).toBe('LOCAL_ONLY');

    // 2. Degraded health
    const resDegraded = decidePolicyRoute({
      fusedEvidence: {
        ...baseFusedEvidence,
        pipelineHealth: 'DEGRADED',
      },
      normalizedInputHash: 'h2',
      durationMs: 20,
    });
    expect(resDegraded.route).toBe('LOCAL');
    expect(resDegraded.action).toBe('LOCAL_ONLY');

    // 3. UNKNOWN scope
    const resScope = decidePolicyRoute({
      fusedEvidence: {
        ...baseFusedEvidence,
        semanticScope: 'UNKNOWN',
      },
      normalizedInputHash: 'h3',
      durationMs: 20,
    });
    expect(resScope.route).toBe('LOCAL');
    expect(resScope.action).toBe('LOCAL_ONLY');

    // 4. Low confidence
    const resLowConf = decidePolicyRoute({
      fusedEvidence: {
        ...baseFusedEvidence,
        semanticConfidence: 0.55, // Below 0.70 threshold
      },
      normalizedInputHash: 'h4',
      durationMs: 20,
    });
    expect(resLowConf.route).toBe('LOCAL');
    expect(resLowConf.action).toBe('LOCAL_ONLY');

    // 5. Critical conflict
    const resConflict = decidePolicyRoute({
      fusedEvidence: {
        ...baseFusedEvidence,
        hasCriticalConflict: true,
      },
      normalizedInputHash: 'h5',
      durationMs: 20,
    });
    expect(resConflict.route).toBe('LOCAL');
    expect(resConflict.action).toBe('LOCAL_ONLY');
  });
});
