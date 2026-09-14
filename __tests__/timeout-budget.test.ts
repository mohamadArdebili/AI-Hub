// Tests for Timeout Budget Validation
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 5, §5.4, spec §49 #512)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validatePolicyConfig } from '@/lib/policy/config-validator';

describe('Timeout Budget & Startup Validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes validation when detection timeout is greater than classifier timeout', () => {
    process.env.POLICY_DETECTION_TIMEOUT_MS = '10000';
    process.env.POLICY_CLASSIFIER_TIMEOUT_MS = '5000';

    const res = validatePolicyConfig();
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
    expect(res.config.detectionTimeoutMs).toBe(10000);
    expect(res.config.classifierTimeoutMs).toBe(5000);
  });

  it('fails validation when detection timeout is less than or equal to internal classifier timeout', () => {
    process.env.POLICY_DETECTION_TIMEOUT_MS = '4000';
    process.env.POLICY_CLASSIFIER_TIMEOUT_MS = '5000';

    const res = validatePolicyConfig();
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('must be strictly greater'))).toBe(true);
  });

  it('fails validation when timeouts are not positive numbers', () => {
    const res = validatePolicyConfig({
      POLICY_DETECTION_TIMEOUT_MS: '-100',
      POLICY_CLASSIFIER_TIMEOUT_MS: '5000',
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('must be a positive integer'))).toBe(true);
  });
});
