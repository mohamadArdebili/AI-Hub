// Unit tests for Evidence Fusion Layer
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 5, §5.2, spec §4.2, Rule 7)

import { describe, it, expect } from 'vitest';
import { fuseEvidence, type EvidenceFusionInput } from '@/lib/policy/detection/evidence-fusion';
import type { DeterministicDlpResult } from '@/lib/policy/detection/deterministic-dlp';
import type { PolicyConcept, RetrievedConcept } from '@/lib/policy/concepts/types';

describe('Evidence Fusion Layer', () => {
  const emptyDeterministic: DeterministicDlpResult = {
    hits: [],
    hasCriticalHit: false,
    hasAlwaysBlock: false,
    durationMs: 2,
    hadInternalError: false,
    timedOut: false,
  };

  const sampleConcept: PolicyConcept = {
    id: 'concept-1',
    organizationId: 'org-1',
    documentId: 'doc-1',
    conceptKey: 'personal_contact_information',
    name: 'Personal Contact Information',
    nameFa: 'اطلاعات تماس پرسنل',
    descriptionFa: 'شامل شماره موبایل و آدرس پرسنل',
    sensitivity: 'CONFIDENTIAL',
    action: 'ROUTE_LOCAL',
    positiveExamples: [],
    negativeExamples: [],
    conditions: [],
    keywords: [],
    sourceQuote: 'شماره تلفن پرسنل محرمانه است.',
    confidence: 1.0,
    reviewStatus: 'ACTIVE',
  };

  const retrievedSample: RetrievedConcept = {
    concept: sampleConcept,
    score: 0.9,
    denseScore: 0.9,
    lexicalScore: 0.8,
    rrfScore: 0.03,
  };

  it('preserves clean SAFE verdict when all evidence is healthy and general', () => {
    const input: EvidenceFusionInput = {
      deterministic: emptyDeterministic,
      retrievedConcepts: [],
      semanticEvidence: {
        decision: 'SAFE',
        scope: 'GENERAL',
        matchedConcepts: [],
        confidence: 0.95,
        reasonFa: 'درخواست دانش عمومی',
        method: 'local_llm',
        modelUsed: 'qwen3:1.7b',
        latencyMs: 100,
      },
      indexValid: true,
    };

    const fused = fuseEvidence(input);
    expect(fused.pipelineHealth).toBe('HEALTHY');
    expect(fused.precedenceAction).toBe('ALLOW_EXTERNAL');
    expect(fused.semanticDecision).toBe('SAFE');
    expect(fused.highestSensitivity).toBe('PUBLIC');
    expect(fused.hasCriticalConflict).toBe(false);
  });

  it('enforces platform baseline alwaysBlock over any semantic classifier result (spec §4.2 B)', () => {
    const input: EvidenceFusionInput = {
      deterministic: {
        hits: [
          {
            detectorType: 'REGEX',
            ruleId: null,
            ruleLabel: 'Private Key',
            matchedSpan: { start: 0, end: 30, text: '-----BEGIN RSA PRIVATE KEY-----' },
            confidence: 1.0,
            category: 'private_key',
            alwaysBlock: true,
            severity: 'critical',
          },
        ],
        hasCriticalHit: true,
        hasAlwaysBlock: true,
        durationMs: 5,
        hadInternalError: false,
        timedOut: false,
      },
      retrievedConcepts: [],
      semanticEvidence: {
        decision: 'SAFE', // Model mistakenly returned SAFE
        scope: 'GENERAL',
        matchedConcepts: [],
        confidence: 0.99,
        reasonFa: 'مدل فکر کرده امن است',
        method: 'local_llm',
        modelUsed: 'qwen3:1.7b',
        latencyMs: 80,
      },
    };

    const fused = fuseEvidence(input);
    expect(fused.precedenceAction).toBe('BLOCK');
    expect(fused.highestSensitivity).toBe('HIGHLY_CONFIDENTIAL');
    expect(fused.hasCriticalConflict).toBe(true);
    expect(fused.pipelineHealth).toBe('DEGRADED');
  });

  it('enforces Rule 7: deterministic critical hit cannot be overridden by semantic classifier', () => {
    const input: EvidenceFusionInput = {
      deterministic: {
        hits: [
          {
            detectorType: 'CHECKSUM',
            ruleId: null,
            ruleLabel: 'کد ملی',
            matchedSpan: { start: 0, end: 10, text: '0012345678' },
            confidence: 1.0,
            category: 'national_id',
            alwaysBlock: false,
            severity: 'critical',
          },
        ],
        hasCriticalHit: true,
        hasAlwaysBlock: false,
        durationMs: 3,
        hadInternalError: false,
        timedOut: false,
      },
      semanticEvidence: {
        decision: 'SAFE',
        scope: 'GENERAL',
        matchedConcepts: [],
        confidence: 0.95,
        reasonFa: 'عمومی',
        method: 'local_llm',
        modelUsed: 'qwen3:1.7b',
        latencyMs: 50,
      },
    };

    const fused = fuseEvidence(input);
    // Deterministic critical forces ROUTE_LOCAL / CONFIDENTIAL
    expect(fused.precedenceAction).toBe('ROUTE_LOCAL');
    expect(fused.highestSensitivity).toBe('CONFIDENTIAL');
    expect(fused.hasCriticalConflict).toBe(true);
    expect(fused.pipelineHealth).toBe('DEGRADED');
  });

  it('resolves concept action precedence: BLOCK > ROUTE_LOCAL > MASK_AND_ALLOW_EXTERNAL > ALLOW_EXTERNAL', () => {
    const conceptAllow: PolicyConcept = {
      ...sampleConcept,
      id: 'c-allow',
      conceptKey: 'public_docs',
      action: 'ALLOW_EXTERNAL',
      sensitivity: 'PUBLIC',
    };
    const conceptMask: PolicyConcept = {
      ...sampleConcept,
      id: 'c-mask',
      conceptKey: 'support_phone',
      action: 'MASK_AND_ALLOW_EXTERNAL',
      sensitivity: 'INTERNAL',
    };
    const conceptLocal: PolicyConcept = {
      ...sampleConcept,
      id: 'c-local',
      conceptKey: 'internal_ip',
      action: 'ROUTE_LOCAL',
      sensitivity: 'CONFIDENTIAL',
    };

    const fused1 = fuseEvidence({
      deterministic: emptyDeterministic,
      retrievedConcepts: [
        { concept: conceptAllow, score: 0.8 },
        { concept: conceptMask, score: 0.9 },
      ],
      semanticEvidence: {
        decision: 'SENSITIVE',
        scope: 'ORG_SPECIFIC',
        matchedConcepts: ['public_docs', 'support_phone'],
        confidence: 0.9,
        reasonFa: 'ماسک گذاری',
        method: 'local_llm',
        modelUsed: 'qwen3',
        latencyMs: 40,
      },
    });
    // MASK > ALLOW
    expect(fused1.precedenceAction).toBe('MASK_AND_ALLOW_EXTERNAL');
    expect(fused1.highestSensitivity).toBe('INTERNAL');

    const fused2 = fuseEvidence({
      deterministic: emptyDeterministic,
      retrievedConcepts: [
        { concept: conceptMask, score: 0.8 },
        { concept: conceptLocal, score: 0.9 },
      ],
      semanticEvidence: {
        decision: 'SENSITIVE',
        scope: 'ORG_SPECIFIC',
        matchedConcepts: ['support_phone', 'internal_ip'],
        confidence: 0.9,
        reasonFa: 'محلی',
        method: 'local_llm',
        modelUsed: 'qwen3',
        latencyMs: 40,
      },
    });
    // ROUTE_LOCAL > MASK
    expect(fused2.precedenceAction).toBe('ROUTE_LOCAL');
    expect(fused2.highestSensitivity).toBe('CONFIDENTIAL');
  });

  it('marks pipeline as DEGRADED when fallback classifier or missing index is present', () => {
    const fused = fuseEvidence({
      deterministic: emptyDeterministic,
      retrievedConcepts: [retrievedSample],
      semanticEvidence: {
        decision: 'UNCERTAIN',
        scope: 'UNKNOWN',
        matchedConcepts: [],
        confidence: 0,
        reasonFa: 'مدل در دسترس نبود (fallback)',
        method: 'fallback',
        modelUsed: 'none',
        latencyMs: 1,
      },
      indexValid: false,
    });

    expect(fused.pipelineHealth).toBe('DEGRADED');
    expect(fused.precedenceAction).toBe('ROUTE_LOCAL');
  });
});
