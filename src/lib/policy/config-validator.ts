// Startup & Runtime Configuration Validator — Sensitive-Data Layer (spec §0.1 item 6, §53)
// Enforces a coherent timeout budget: total pipeline detection timeout must exceed stage timeouts.

export interface PolicyTimeoutConfig {
  detectionTimeoutMs: number;
  classifierTimeoutMs: number;
  ollamaAvailabilityTimeoutMs: number;
  ollamaExtractionTimeoutMs: number;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  config: PolicyTimeoutConfig;
}

export class PolicyConfigurationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(`Invalid policy configuration: ${errors.join('; ')}`);
    this.name = 'PolicyConfigurationError';
    this.errors = errors;
  }
}

/**
 * Reads policy timeout configuration from environment variables with safe defaults.
 */
export function getPolicyTimeoutConfig(
  env: Record<string, string | undefined> = process.env,
): PolicyTimeoutConfig {
  const detectionTimeoutMs = parseInt(
    env.POLICY_DETECTION_TIMEOUT_MS ?? '15000',
    10,
  );
  const classifierTimeoutMs = parseInt(
    env.POLICY_CLASSIFIER_TIMEOUT_MS ?? env.CLASSIFIER_TIMEOUT_MS ?? '8000',
    10,
  );
  const ollamaAvailabilityTimeoutMs = parseInt(
    env.OLLAMA_AVAILABILITY_TIMEOUT_MS ?? '2000',
    10,
  );
  const ollamaExtractionTimeoutMs = parseInt(
    env.OLLAMA_EXTRACTION_TIMEOUT_MS ?? '30000',
    10,
  );

  return {
    detectionTimeoutMs,
    classifierTimeoutMs,
    ollamaAvailabilityTimeoutMs,
    ollamaExtractionTimeoutMs,
  };
}

/**
 * Validates the policy timeout budget.
 * Invariant: POLICY_DETECTION_TIMEOUT_MS must be strictly greater than internal classifier timeout.
 */
export function validatePolicyConfig(
  env: Record<string, string | undefined> = process.env,
): ConfigValidationResult {
  const errors: string[] = [];
  const config = getPolicyTimeoutConfig(env);

  if (Number.isNaN(config.detectionTimeoutMs) || config.detectionTimeoutMs <= 0) {
    errors.push('POLICY_DETECTION_TIMEOUT_MS must be a positive integer');
  }

  if (Number.isNaN(config.classifierTimeoutMs) || config.classifierTimeoutMs <= 0) {
    errors.push('POLICY_CLASSIFIER_TIMEOUT_MS must be a positive integer');
  }

  if (
    !Number.isNaN(config.detectionTimeoutMs) &&
    !Number.isNaN(config.classifierTimeoutMs) &&
    config.detectionTimeoutMs <= config.classifierTimeoutMs
  ) {
    errors.push(
      `POLICY_DETECTION_TIMEOUT_MS (${config.detectionTimeoutMs}ms) must be strictly greater than internal classifier timeout (${config.classifierTimeoutMs}ms)`,
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    config,
  };
}

/**
 * Assert that policy configuration is valid. Throws PolicyConfigurationError if invalid.
 */
export function assertValidPolicyConfig(
  env: Record<string, string | undefined> = process.env,
): PolicyTimeoutConfig {
  const result = validatePolicyConfig(env);
  if (!result.valid) {
    throw new PolicyConfigurationError(result.errors);
  }
  return result.config;
}
