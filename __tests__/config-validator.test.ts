import { describe, it, expect } from 'vitest';
import {
  validatePolicyConfig,
  assertValidPolicyConfig,
  PolicyConfigurationError,
  getPolicyTimeoutConfig,
} from '../src/lib/policy/config-validator';

describe('Policy Configuration & Timeout Budget Validator', () => {
  it('accepts valid coherent timeout budget (detection > classifier)', () => {
    const res = validatePolicyConfig({
      POLICY_DETECTION_TIMEOUT_MS: '15000',
      POLICY_CLASSIFIER_TIMEOUT_MS: '8000',
      OLLAMA_AVAILABILITY_TIMEOUT_MS: '2000',
      OLLAMA_EXTRACTION_TIMEOUT_MS: '30000',
    });

    expect(res.valid).toBe(true);
    expect(res.errors.length).toBe(0);
    expect(res.config.detectionTimeoutMs).toBe(15000);
    expect(res.config.classifierTimeoutMs).toBe(8000);
  });

  it('rejects inconsistent timeout budget (detection <= classifier)', () => {
    const res = validatePolicyConfig({
      POLICY_DETECTION_TIMEOUT_MS: '3000',
      POLICY_CLASSIFIER_TIMEOUT_MS: '8000',
    });

    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toContain('must be strictly greater than');
  });

  it('rejects equal timeouts', () => {
    const res = validatePolicyConfig({
      POLICY_DETECTION_TIMEOUT_MS: '5000',
      POLICY_CLASSIFIER_TIMEOUT_MS: '5000',
    });

    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('must be strictly greater than');
  });

  it('rejects non-positive or NaN values', () => {
    const res = validatePolicyConfig({
      POLICY_DETECTION_TIMEOUT_MS: '-100',
      POLICY_CLASSIFIER_TIMEOUT_MS: 'abc',
    });

    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('assertValidPolicyConfig throws PolicyConfigurationError on invalid config', () => {
    expect(() =>
      assertValidPolicyConfig({
        POLICY_DETECTION_TIMEOUT_MS: '2000',
        POLICY_CLASSIFIER_TIMEOUT_MS: '5000',
      }),
    ).toThrow(PolicyConfigurationError);
  });

  it('assertValidPolicyConfig returns config on valid config', () => {
    const cfg = assertValidPolicyConfig({
      POLICY_DETECTION_TIMEOUT_MS: '10000',
      POLICY_CLASSIFIER_TIMEOUT_MS: '4000',
    });
    expect(cfg.detectionTimeoutMs).toBe(10000);
    expect(cfg.classifierTimeoutMs).toBe(4000);
  });

  it('falls back to CLASSIFIER_TIMEOUT_MS if POLICY_CLASSIFIER_TIMEOUT_MS is missing', () => {
    const cfg = getPolicyTimeoutConfig({
      POLICY_DETECTION_TIMEOUT_MS: '12000',
      CLASSIFIER_TIMEOUT_MS: '6000',
    });
    expect(cfg.classifierTimeoutMs).toBe(6000);
  });
});
