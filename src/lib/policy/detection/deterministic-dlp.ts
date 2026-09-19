// Deterministic DLP Layer
// (MIGRATION_PLAN_REVIEWED_v1.1 §5.1, spec §57 Step 4 & 5, Rule 7)

import { detectDeclaredSensitiveHits } from './declared-sensitive';
import { normalizePersian } from '../normalize';
import {
  detectBankCardHits,
  detectBulkContactHits,
  detectCompiledRuleHits,
  detectDictionaryHits,
  detectIbanHits,
  detectJailbreakHits,
  detectNationalIdHits,
  detectSecretHits,
  isValidIban,
} from '../detectors';
import type { CompiledPolicyRule, DetectionHit } from '../types';

export interface ScanContext {
  original: string;
  normalized: string;
}

export interface DeterministicHit extends DetectionHit {
  /**
   * True only for a platform rule that forbids generation (confirmed jailbreaks).
   * Credentials forbid external processing but can still be processed locally.
   */
  alwaysBlock?: boolean;
  severity?: 'low' | 'medium' | 'high' | 'critical';
}

export interface DeterministicDlpInput {
  prompt: string;
  normalizedPrompt?: string;
  compiledRules?: CompiledPolicyRule[];
  dictionaries?: {
    seniorOfficers?: string[];
    telcoHubNodes?: string[];
    proprietaryServices?: string[];
  };
  sourceRef?: { documentId: string; page?: number };
}

export interface DeterministicDlpResult {
  hits: DeterministicHit[];
  hasCriticalHit: boolean;
  hasAlwaysBlock: boolean;
  durationMs: number;
  hadInternalError: boolean;
  timedOut: boolean;
}

/** Categories that are platform baseline non-negotiable violations */
const ALWAYS_BLOCK_CATEGORIES = new Set([
  'jailbreak_injection',
]);

const CRITICAL_CATEGORIES = new Set([
  'personal_contact',
  'national_id',
  'ir_bank_card',
  'iban',
  'api_key',
  'private_key',
  'credential',
  'connection_string',
  'jailbreak_injection',
]);

/**
 * Runs deterministic detectors (checksums, regex patterns, dictionaries, jailbreak)
 * against the user prompt with isolated error handling and deadline budgeting.
 */
export function runDeterministicDlp(
  input: DeterministicDlpInput,
  options?: { deadline?: number },
): DeterministicDlpResult {
  const startedAt = Date.now();
  const deadline = options?.deadline ?? Infinity;

  const original = input.prompt;
  const normalized = input.normalizedPrompt ?? normalizePersian(original);
  const ctx: ScanContext = { original, normalized };

  const rawHits: DetectionHit[] = [];
  let hadInternalError = false;

  const runStep = (name: string, fn: () => DetectionHit[]): void => {
    if (Date.now() > deadline) {
      hadInternalError = true;
      return;
    }
    try {
      rawHits.push(...fn());
    } catch (err) {
      hadInternalError = true;
      console.error(
        `[deterministic-dlp] detector "${name}" failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  };

  // 1. Checksums
  runStep('checksum:national_id', () => detectNationalIdHits(ctx));
  runStep('checksum:bank_card', () => detectBankCardHits(ctx));
  runStep('checksum:iban', () => detectIbanHits(ctx));

  // 2. Builtin Regex & Patterns
  runStep('regex:declared_values', () => detectDeclaredSensitiveHits(normalized));
  runStep('regex:secrets', () => detectSecretHits(ctx));
  runStep('regex:bulk_contact', () => detectBulkContactHits(ctx));

  // 3. Dictionaries
  if (input.dictionaries) {
    const dicts = {
      // A name alone is explicitly exempt; semantic rules evaluate its context.
      seniorOfficers: [],
      telcoHubNodes: input.dictionaries.telcoHubNodes ?? [],
      proprietaryServices: input.dictionaries.proprietaryServices ?? [],
    };
    runStep('dictionary:mask_dictionary', () =>
      detectDictionaryHits(ctx, dicts, input.sourceRef),
    );
  }

  // 4. Compiled DB Rules (REGEX and DICTIONARY)
  if (input.compiledRules && input.compiledRules.length > 0) {
    const regexDictRules = input.compiledRules.filter(
      (r) => r.detectorType === 'REGEX' || r.detectorType === 'DICTIONARY',
    );
    if (regexDictRules.length > 0) {
      runStep('compiled:regex_dictionary', () =>
        detectCompiledRuleHits(ctx, regexDictRules),
      );
    }
  }

  // 5. Jailbreak & Prompt Injection Scan
  runStep('semantic:jailbreak', () => detectJailbreakHits(ctx));

  const timedOut = Date.now() > deadline;

  // Annotate hits with baseline severity & alwaysBlock attributes
  const hits: DeterministicHit[] = rawHits.map((h) => {
    const isAlwaysBlock =
      ALWAYS_BLOCK_CATEGORIES.has(h.category);

    const isCritical = CRITICAL_CATEGORIES.has(h.category) || isAlwaysBlock ||
      (input.compiledRules?.some((r) => r.id === h.ruleId && r.action === 'BLOCK_EXTERNAL') ?? false);
    const severity: DeterministicHit['severity'] = isCritical
      ? 'critical'
      : h.confidence >= 0.85
      ? 'high'
      : 'medium';

    return {
      ...h,
      alwaysBlock: isAlwaysBlock,
      severity,
    };
  });

  const hasAlwaysBlock = hits.some((h) => h.alwaysBlock);
  const hasCriticalHit = hits.some((h) => h.severity === 'critical');

  return {
    hits,
    hasCriticalHit,
    hasAlwaysBlock,
    durationMs: Date.now() - startedAt,
    hadInternalError,
    timedOut,
  };
}

// Re-export individual detectors for direct consumers and tests
export {
  detectNationalIdHits,
  detectBankCardHits,
  detectIbanHits,
  detectSecretHits,
  detectBulkContactHits,
  detectJailbreakHits,
  detectDictionaryHits,
  detectCompiledRuleHits,
  isValidIban,
};
