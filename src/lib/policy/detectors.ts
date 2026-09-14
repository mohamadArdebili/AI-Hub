// Detection layers — standalone, no Next.js imports

import type { RuleInput, ChunkInput, DetectionResult, MatchedRule } from './types';
import type { DetectionHit } from './types';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function emptyResult(): DetectionResult {
  return { blocked: false, reasons: [], matchedRules: [], score: 0 };
}

function toMatchedRule(rule: RuleInput): MatchedRule {
  return { code: rule.code, title: rule.title, severity: rule.severity };
}

// ──────────────────────────────────────────────
// Sensitive Data Detection
// ──────────────────────────────────────────────

/**
 * Validate Iranian National ID (کد ملی) checksum.
 * 10 digits: sum of digits[i] * (10 - i) for i=0..8, then check digit.
 */
function isValidIranianNationalId(digits: string): boolean {
  if (digits.length !== 10) return false;
  if (!/^\d{10}$/.test(digits)) return false;
  // Reject all-same-digit numbers
  if (/^(.)\1{9}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i], 10) * (10 - i);
  }
  const remainder = sum % 11;
  const checkDigit = parseInt(digits[9], 10);

  if (remainder < 2) {
    return checkDigit === remainder;
  }
  return checkDigit === 11 - remainder;
}

/**
 * Validate credit card number using Luhn algorithm.
 */
function isValidLuhn(number: string): boolean {
  if (!/^\d{16}$/.test(number)) return false;
  let sum = 0;
  let alternate = false;
  for (let i = number.length - 1; i >= 0; i--) {
    let n = parseInt(number[i], 10);
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function detectSensitiveData(text: string, normalizedText: string): DetectionResult {
  const result = emptyResult();

  // Use normalizedText for digit-based detection (digits are already Latin after normalization)
  const scanText = normalizedText;

  // Iranian National ID: 10-digit sequences with valid checksum
  const nationalIdRegex = /\b(\d{10})\b/g;
  let nidMatch: RegExpExecArray | null;
  let nidCount = 0;
  while ((nidMatch = nationalIdRegex.exec(scanText)) !== null) {
    if (isValidIranianNationalId(nidMatch[1])) {
      nidCount++;
    }
  }
  if (nidCount > 0) {
    result.blocked = true;
    result.reasons.push(
      `شناسایی ${nidCount} کد ملی معتبر در متن — ارسال کد ملی مجاز نیست`,
    );
    result.matchedRules.push({
      code: 'SENSITIVE_NATIONAL_ID',
      title: 'کد ملی',
      severity: 'CRITICAL',
    });
    result.score = 1.0;
  }

  // IBAN/Sheba: IR + 24 digits
  const ibanRegex = /\bIR\d{24}\b/gi;
  const ibanMatches = scanText.match(ibanRegex);
  if (ibanMatches && ibanMatches.length > 0) {
    result.blocked = true;
    result.reasons.push(
      `شناسایی ${ibanMatches.length} شماره شبا/iban — ارسال اطلاعات بانکی مجاز نیست`,
    );
    result.matchedRules.push({
      code: 'SENSITIVE_IBAN',
      title: 'شماره شبا',
      severity: 'CRITICAL',
    });
    result.score = 1.0;
  }

  // Credit card: 16-digit sequences with Luhn validation
  const ccRegex = /\b(\d{16})\b/g;
  let ccMatch: RegExpExecArray | null;
  let ccCount = 0;
  while ((ccMatch = ccRegex.exec(scanText)) !== null) {
    if (isValidLuhn(ccMatch[1])) {
      ccCount++;
    }
  }
  if (ccCount > 0) {
    result.blocked = true;
    result.reasons.push(
      `شناسایی ${ccCount} شماره کارت بانکی معتبر — ارسال شماره کارت مجاز نیست`,
    );
    result.matchedRules.push({
      code: 'SENSITIVE_CREDIT_CARD',
      title: 'شماره کارت بانکی',
      severity: 'CRITICAL',
    });
    result.score = 1.0;
  }

  // Email addresses: flag only if 3+ found
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const emailMatches = text.match(emailRegex);
  if (emailMatches && emailMatches.length >= 3) {
    result.blocked = true;
    result.reasons.push(
      `شناسایی ${emailMatches.length} آدرس ایمیل — ارسال انبوه اطلاعات تماس مجاز نیست`,
    );
    result.matchedRules.push({
      code: 'SENSITIVE_EMAIL_BULK',
      title: 'آدرس ایمیل (انبوه)',
      severity: 'HIGH',
    });
    result.score = Math.max(result.score, 0.8);
  }

  // Mobile numbers: flag only if 3+ found
  const mobileRegex = /\b09\d{9}\b/g;
  const mobileMatches = scanText.match(mobileRegex);
  if (mobileMatches && mobileMatches.length >= 3) {
    result.blocked = true;
    result.reasons.push(
      `شناسایی ${mobileMatches.length} شماره موبایل — ارسال انبوه شماره تماس مجاز نیست`,
    );
    result.matchedRules.push({
      code: 'SENSITIVE_MOBILE_BULK',
      title: 'شماره موبایل (انبوه)',
      severity: 'HIGH',
    });
    result.score = Math.max(result.score, 0.8);
  }

  // API keys and secrets
  const apiPatterns: Array<{ regex: RegExp; label: string }> = [
    { regex: /\bsk-[a-zA-Z0-9]{20,}\b/g, label: 'کلید API' },
    { regex: /\bAKIA[A-Z0-9]{16}\b/g, label: 'کلید AWS' },
    { regex: /-----BEGIN[\s\S]*?PRIVATE KEY-----/g, label: 'کلید خصوصی' },
    {
      regex: /\b(?:password|passwd|secret|token)\s*=\s*\S+/gi,
      label: 'اطلاعات حساس اتصال',
    },
    {
      regex: /\b(?:mongodb|mysql|postgres|redis|amqp)\+?\S*:\/\/\S+/gi,
      label: 'رشته اتصال پایگاه داده',
    },
    {
      regex: /\bhost\s*=\s*\S+[\s\S]*?(?:port|password)\s*=\s*\S+/gi,
      label: 'اطلاعات اتصال سرور',
    },
  ];

  for (const { regex, label } of apiPatterns) {
    const matches = text.match(regex);
    if (matches && matches.length > 0) {
      result.blocked = true;
      result.reasons.push(
        `شناسایی ${matches.length} مورد ${label} — ارسال کلیدها و اعتبارنامه‌ها مجاز نیست`,
      );
      result.matchedRules.push({
        code: 'SENSITIVE_API_KEY',
        title: label,
        severity: 'CRITICAL',
      });
      result.score = 1.0;
      break; // One match is enough for API keys
    }
  }

  return result;
}

// ──────────────────────────────────────────────
// Keyword Rules Detection
// ──────────────────────────────────────────────

export function detectKeywordRules(normalizedText: string, rules: RuleInput[]): DetectionResult {
  const result = emptyResult();

  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (rule.keywords.length === 0) continue;

    for (const keyword of rule.keywords) {
      // Replace ZWNJ in keyword with space for matching (since we normalize ZWNJ)
      const searchKeyword = keyword.replace(/\u200C/g, ' ');

      // For multi-word keywords, check if all words appear with word boundaries
      const words = searchKeyword.split(/\s+/).filter(Boolean);

      if (words.length === 0) continue;

      // Build a regex with word boundaries around the entire phrase
      // Escape special regex characters in each word
      const escapedWords = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      // Allow flexible whitespace between words
      const pattern = escapedWords.join('\\s+');

      try {
        const regex = new RegExp(`(?:^|\\s)${pattern}(?:\\s|$)`, 'i');
        if (regex.test(normalizedText)) {
          result.blocked = true;
          result.matchedRules.push(toMatchedRule(rule));
          // Don't add duplicate reasons for same rule
          if (!result.reasons.some((r) => r.includes(rule.code))) {
            result.reasons.push(
              `تطابق با قانون «${rule.title}» (${rule.code})`,
            );
          }
          // Calculate score based on severity
          const severityScore: Record<string, number> = {
            LOW: 0.3,
            MEDIUM: 0.5,
            HIGH: 0.8,
            CRITICAL: 1.0,
          };
          result.score = Math.max(
            result.score,
            severityScore[rule.severity] ?? 0.5,
          );
          break; // One keyword match per rule is enough
        }
      } catch {
        // If regex construction fails, try simple string includes
        if (normalizedText.includes(searchKeyword)) {
          result.blocked = true;
          result.matchedRules.push(toMatchedRule(rule));
          if (!result.reasons.some((r) => r.includes(rule.code))) {
            result.reasons.push(
              `تطابق با قانون «${rule.title}» (${rule.code})`,
            );
          }
          const severityScore: Record<string, number> = {
            LOW: 0.3,
            MEDIUM: 0.5,
            HIGH: 0.8,
            CRITICAL: 1.0,
          };
          result.score = Math.max(
            result.score,
            severityScore[rule.severity] ?? 0.5,
          );
          break;
        }
      }
    }
  }

  return result;
}

// ──────────────────────────────────────────────
// BM25 Similarity
// ──────────────────────────────────────────────

/**
 * Simple tokenizer: split on non-word characters, filter empty tokens.
 */
function tokenize(text: string): string[] {
  return text
    .split(/[^\w\u200C]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Compute BM25 scores for each chunk given a query.
 */
export function computeBM25(
  promptTokens: string[],
  chunkTokens: string[][],
): number[] {
  const k1 = 1.5;
  const b = 0.75;

  const N = chunkTokens.length;
  if (N === 0 || promptTokens.length === 0) {
    return new Array(N).fill(0);
  }

  // Average document length
  const totalLength = chunkTokens.reduce((sum, chunk) => sum + chunk.length, 0);
  const avgdl = totalLength / N;

  // Document frequency for each query term
  const df = new Map<string, number>();
  for (const term of promptTokens) {
    if (df.has(term)) continue;
    let count = 0;
    for (const chunk of chunkTokens) {
      if (chunk.includes(term)) count++;
    }
    df.set(term, count);
  }

  // Compute BM25 for each chunk
  const scores: number[] = [];
  for (const chunk of chunkTokens) {
    let score = 0;
    const dl = chunk.length;

    for (const term of promptTokens) {
      const termDf = df.get(term) ?? 0;
      // IDF: log((N - df + 0.5) / (df + 0.5) + 1)
      const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);

      // Term frequency in this chunk
      let tf = 0;
      for (const t of chunk) {
        if (t === term) tf++;
      }

      // BM25 term score
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (dl / (avgdl || 1)));
      score += idf * (numerator / denominator);
    }

    scores.push(score);
  }

  return scores;
}

/**
 * Detect similarity between the prompt and restricted chunks using BM25.
 */
export function detectSimilarity(
  normalizedPrompt: string,
  rules: RuleInput[],
  chunks: ChunkInput[],
  threshold?: number,
): DetectionResult {
  const result = emptyResult();

  const bm25Threshold = threshold ??
    parseFloat(process.env.POLICY_BM25_THRESHOLD ?? '0.3');

  // Only check restricted chunks
  const restrictedChunks = chunks.filter((c) => c.isRestricted);
  if (restrictedChunks.length === 0) return result;

  // Tokenize prompt
  const promptTokens = tokenize(normalizedPrompt);
  if (promptTokens.length === 0) return result;

  // Tokenize chunks (use pre-normalized content)
  const chunkTokens = restrictedChunks.map((c) => tokenize(c.normalizedContent));

  // Compute BM25 scores
  const scores = computeBM25(promptTokens, chunkTokens);

  // Collect matched chunks and their associated rules
  const matchedRuleCodes = new Set<string>();
  const matchedChunks: Array<{ chunk: ChunkInput; score: number }> = [];

  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > bm25Threshold) {
      matchedChunks.push({
        chunk: restrictedChunks[i],
        score: scores[i],
      });
    }
  }

  if (matchedChunks.length > 0) {
    result.blocked = true;

    // Find rules whose keywords appear in the matched chunks
    for (const rule of rules) {
      if (!rule.isActive) continue;
      for (const { chunk, score } of matchedChunks) {
        // Check if any keyword of this rule appears in the matched chunk
        let found = false;
        for (const keyword of rule.keywords) {
          const searchKeyword = keyword.replace(/\u200C/g, ' ');
          if (chunk.normalizedContent.includes(searchKeyword)) {
            found = true;
            break;
          }
        }
        if (found && !matchedRuleCodes.has(rule.code)) {
          matchedRuleCodes.add(rule.code);
          result.matchedRules.push(toMatchedRule(rule));
        }
      }
    }

    const topScore = Math.max(...matchedChunks.map((c) => c.score));
    result.score = Math.min(topScore, 1.0);
    result.reasons.push(
      `تطابق محتوایی با ${matchedChunks.length} بخش محدود شده (امتیاز BM25: ${topScore.toFixed(3)})`,
    );
  }

  return result;
}

// ──────────────────────────────────────────────
// Behavioral Patterns Detection
// ──────────────────────────────────────────────

export function detectBehavioralPatterns(
  normalizedText: string,
  originalText: string,
): DetectionResult {
  const result = emptyResult();

  // Rewrite/summarize/translate commands
  const rewritePatterns = [
    'بازنویسی کن',
    'بازنویسی',
    'خلاصه کن',
    'ترجمه کن',
    'پارافریز',
  ];

  // Confidentiality indicators
  const confidentialityPatterns = [
    'صورت‌جلسه',
    'قرارداد',
    'محرمانه',
    'داخلی',
    'طبقه‌بندی‌شده',
    'حقوق و دستمزد',
    'سرمایه‌گذاری',
    'مالی',
    'بودجه',
  ];

  let hasRewriteCommand = false;
  let matchedRewritePattern = '';
  for (const pattern of rewritePatterns) {
    if (normalizedText.includes(pattern)) {
      hasRewriteCommand = true;
      matchedRewritePattern = pattern;
      break;
    }
  }

  let hasConfidentialityIndicator = false;
  let matchedConfidentialPatterns: string[] = [];
  for (const pattern of confidentialityPatterns) {
    // Normalize the pattern too (replace ZWNJ with space for matching)
    const normalizedPattern = pattern.replace(/\u200C/g, ' ');
    if (normalizedText.includes(normalizedPattern)) {
      hasConfidentialityIndicator = true;
      matchedConfidentialPatterns.push(pattern);
    }
  }

  // Both rewrite command AND confidentiality indicator → CRITICAL BLOCK
  if (hasRewriteCommand && hasConfidentialityIndicator) {
    result.blocked = true;
    result.reasons.push(
      `درخواست بازنویسی/تغییر محتوای محرمانه شناسایی شد — دستور «${matchedRewritePattern}» همراه با شاخص‌های محرمانگی: ${matchedConfidentialPatterns.join('، ')}`,
    );
    result.matchedRules.push({
      code: 'BEHAVIORAL_CONFIDENTIAL_REWRITE',
      title: 'بازنویسی محتوای محرمانه',
      severity: 'CRITICAL',
    });
    result.score = 1.0;
  }

  // Very long prompt with high density of organizational entities
  // Check for density of organizational keywords
  const orgEntityKeywords = [
    'سازمان',
    'شرکت',
    'مدیر',
    'هیئت',
    'دستگاه',
    'وزارت',
    'اداره',
    'معاونت',
    'بخش',
    'واحد',
    'ستاد',
    'دولت',
  ];

  if (originalText.length > 500) {
    let entityCount = 0;
    for (const kw of orgEntityKeywords) {
      // Count occurrences
      let idx = normalizedText.indexOf(kw);
      while (idx !== -1) {
        entityCount++;
        idx = normalizedText.indexOf(kw, idx + 1);
      }
    }

    // Density: entities per 1000 characters
    const density = (entityCount / originalText.length) * 1000;
    if (density > 5) {
      result.blocked = true;
      result.reasons.push(
        `متن طولانی با تراکم بالای موجودیت‌های سازمانی (${density.toFixed(1)} به ازای هر ۱۰۰۰ کاراکتر) — احتمال نشت اطلاعات`,
      );
      result.matchedRules.push({
        code: 'BEHAVIORAL_ORG_ENTITY_LEAK',
        title: 'نشت اطلاعات سازمانی',
        severity: 'HIGH',
      });
      result.score = Math.max(result.score, 0.8);
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// Sensitive-Data Layer — deterministic hit detectors
//
// These complement the legacy DetectionResult producers above with span-level
// DetectionHit output (start/end/text + confidence) required by the runtime
// detection pipeline. All checks are fully deterministic — no LLM involved.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Checksum validators (real algorithms, not regex-only) ─────────────────

export { isValidIranianNationalId, isValidLuhn };

/**
 * Validate an IBAN with the official mod-97 check (ISO 13616).
 * Accepts forms with or without spaces; letters are case-insensitive.
 * Iranian IBANs: IR + 2 check digits + 21 bank/account digits (26 chars).
 */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith('IR') && iban.length !== 26) return false;

  // Move the first 4 characters to the end, then convert A=10..Z=35.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const value = ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : parseInt(ch, 10);
    if (Number.isNaN(value)) return false;
    // Modulo in chunks keeps intermediate numbers within safe integer range.
    remainder = (remainder * (value < 10 ? 10 : 100) + value) % 97;
  }
  return remainder === 1;
}

// ─── Hit producers (span + confidence) ─────────────────────────────────────

/** Confidence tiers used by the classifier (>= 0.85 → SENSITIVE). */
export const HIT_CONFIDENCE = {
  CHECKSUM_VALID: 0.95,
  SECRET_PATTERN: 0.92,
  DICTIONARY_EXACT: 0.88,
  BULK_CONTACT: 0.8,
  KEYWORD_RULE: 0.85,
  JAILBREAK: 0.95,
  WEAK_SIGNAL: 0.6,
} as const;

interface ScanContext {
  /** Original (un-normalized) prompt — spans refer to the normalized text. */
  original: string;
  /** Normalized prompt (digits latinized) — the scan target. */
  normalized: string;
}

function pushHits(
  hits: DetectionHit[],
  ctx: ScanContext,
  opts: {
    detectorType: DetectionHit['detectorType'];
    ruleId: string | null;
    ruleLabel: string;
    category: string;
    confidence: number;
    regex: RegExp;
    validate?: (candidate: string) => boolean;
    sourceRef?: DetectionHit['sourceRef'];
    limit?: number;
    /** scan the ORIGINAL text instead of the normalized one */
    scanOriginal?: boolean;
  },
): void {
  const { regex, validate } = opts;
  const scanText = opts.scanOriginal ? ctx.original : ctx.normalized;
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  let count = 0;
  while ((match = regex.exec(scanText)) !== null) {
    const candidate = match[1] ?? match[0];
    if (validate && !validate(candidate)) continue;
    const start = match.index;
    const end = start + match[0].length;
    hits.push({
      detectorType: opts.detectorType,
      ruleId: opts.ruleId,
      ruleLabel: opts.ruleLabel,
      matchedSpan: { start, end, text: match[0] },
      confidence: opts.confidence,
      category: opts.category,
      sourceRef: opts.sourceRef,
    });
    count++;
    if (opts.limit && count >= opts.limit) break;
  }
  regex.lastIndex = 0;
}

/** Valid Iranian national IDs (mod-11 checksum) in the normalized text. */
export function detectNationalIdHits(ctx: ScanContext): DetectionHit[] {
  const hits: DetectionHit[] = [];
  pushHits(hits, ctx, {
    detectorType: 'CHECKSUM',
    ruleId: null,
    ruleLabel: 'کد ملی',
    category: 'national_id',
    confidence: HIT_CONFIDENCE.CHECKSUM_VALID,
    regex: /(?<![0-9.])([0-9]{10})(?![0-9.])/g,
    validate: isValidIranianNationalId,
  });
  return hits;
}

/** Valid Iranian bank-card numbers (Luhn checksum, 16 digits). */
export function detectBankCardHits(ctx: ScanContext): DetectionHit[] {
  const hits: DetectionHit[] = [];
  pushHits(hits, ctx, {
    detectorType: 'CHECKSUM',
    ruleId: null,
    ruleLabel: 'شماره کارت بانکی',
    category: 'ir_bank_card',
    confidence: HIT_CONFIDENCE.CHECKSUM_VALID,
    // Grouped forms (6037-XXXX-XXXX-XXXX / 6037 XXXX ...) flatten to 16 digits.
    regex: /(?<![0-9.])(?:[0-9][0-9-\s]{14,18}[0-9])(?![0-9.])/g,
    validate: (candidate) => {
      const flat = candidate.replace(/[\s-]/g, '');
      return flat.length === 16 && isValidLuhn(flat);
    },
  });
  return hits;
}

/** Valid IBAN / Sheba numbers (mod-97 checksum). */
export function detectIbanHits(ctx: ScanContext): DetectionHit[] {
  const hits: DetectionHit[] = [];
  pushHits(hits, ctx, {
    detectorType: 'CHECKSUM',
    ruleId: null,
    ruleLabel: 'شماره شبا',
    category: 'iban',
    confidence: HIT_CONFIDENCE.CHECKSUM_VALID,
    regex: /\b(IR[0-9]{2}[0-9]{21}|[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30})\b/gi,
    validate: (candidate) => {
      // Avoid double-reporting bank cards that happen to match the loose arm.
      if (!/^IR/i.test(candidate) && ctx.original.length > 0) {
        // Loose arm only accepts when it looks like an IBAN context — keep it
        // conservative: require the text around it to mention شبا/IBAN.
        const around = ctx.normalized.slice(
          Math.max(0, (ctx.normalized.indexOf(candidate) ?? 0) - 40),
        );
        return /شبا|iban/i.test(around);
      }
      return isValidIban(candidate);
    },
  });
  return hits;
}

/** Secrets / credentials patterns (API keys, private keys, connection strings). */
export function detectSecretHits(ctx: ScanContext): DetectionHit[] {
  const hits: DetectionHit[] = [];
  const specs: Array<{ re: RegExp; label: string; category: string }> = [
    { re: /\bsk-[A-Za-z0-9]{20,}\b/g, label: 'کلید API', category: 'api_key' },
    { re: /\bAKIA[A-Z0-9]{16}\b/g, label: 'کلید AWS', category: 'api_key' },
    { re: /-----BEGIN[\s\S]*?PRIVATE KEY-----/g, label: 'کلید خصوصی', category: 'private_key' },
    {
      re: /\b(?:password|passwd|secret|token)\s*[=:]\s*\S+/gi,
      label: 'اعتبارنامه اتصال',
      category: 'credential',
    },
    {
      re: /\b(?:mongodb|mysql|postgres(?:ql)?|redis|amqp)(?:\+\S*)?:\/\/\S+/gi,
      label: 'رشته اتصال پایگاه داده',
      category: 'connection_string',
    },
  ];
  for (const spec of specs) {
    pushHits(hits, ctx, {
      detectorType: 'REGEX',
      ruleId: null,
      ruleLabel: spec.label,
      category: spec.category,
      confidence: HIT_CONFIDENCE.SECRET_PATTERN,
      regex: spec.re,
      limit: 5,
      scanOriginal: true,
    });
  }
  return hits;
}

/** Bulk contact info (3+ emails or 3+ mobile numbers) — legacy semantic port. */
export function detectBulkContactHits(ctx: ScanContext): DetectionHit[] {
  const hits: DetectionHit[] = [];
  const emails = ctx.original.match(
    /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  );
  if (emails && emails.length >= 3) {
    hits.push({
      detectorType: 'REGEX',
      ruleId: null,
      ruleLabel: 'آدرس ایمیل (انبوه)',
      matchedSpan: { start: 0, end: 0, text: `${emails.length} ایمیل` },
      confidence: HIT_CONFIDENCE.BULK_CONTACT,
      category: 'bulk_email',
    });
  }
  const mobiles = ctx.normalized.match(/(?:^|[^0-9])(09[0-9]{9})(?![0-9])/g);
  if (mobiles && mobiles.length >= 3) {
    hits.push({
      detectorType: 'REGEX',
      ruleId: null,
      ruleLabel: 'شماره موبایل (انبوه)',
      matchedSpan: { start: 0, end: 0, text: `${mobiles.length} موبایل` },
      confidence: HIT_CONFIDENCE.BULK_CONTACT,
      category: 'bulk_mobile',
    });
  }
  return hits;
}

/** Jailbreak / prompt-injection attempts (deterministic keyword scan). */
export function detectJailbreakHits(ctx: ScanContext): DetectionHit[] {
  const hits: DetectionHit[] = [];
  const patterns = [
    'نادیده بگیر', 'دستورات قبلی را', 'ignore previous', 'ignore all previous',
    'disregard previous', 'disregard all', 'بدون هیچ محدودیت', 'بدون محدودیت پاسخ',
    'system prompt', 'پرامپت سیستمی', 'jailbreak', 'prompt injection',
    'developer mode', 'dan mode', 'قوانین را دور بزن', 'tell me your instructions',
  ];
  for (const p of patterns) {
    const idx = ctx.normalized.toLowerCase().indexOf(p.toLowerCase());
    if (idx !== -1) {
      hits.push({
        detectorType: 'SEMANTIC',
        ruleId: null,
        ruleLabel: 'تلاش دور زدن فیلتر',
        matchedSpan: { start: idx, end: idx + p.length, text: p },
        confidence: HIT_CONFIDENCE.JAILBREAK,
        category: 'jailbreak_injection',
      });
    }
  }
  return hits;
}

/**
 * Dictionary-based detector fed by the organization's mask dictionary.
 * Multi-word and sub-word matches are supported; the term patterns tolerate
 * Persian orthography variants (ی/ي، ک/ك، ZWNJ، فاصله).
 */
export function detectDictionaryHits(
  ctx: ScanContext,
  dictionaries: { seniorOfficers: string[]; telcoHubNodes: string[]; proprietaryServices: string[] },
  sourceRef?: DetectionHit['sourceRef'],
): DetectionHit[] {
  const hits: DetectionHit[] = [];
  const specs: Array<{ label: string; category: string; terms: string[] }> = [
    { label: 'مدیر ارشد', category: 'senior_officer', terms: dictionaries.seniorOfficers },
    { label: 'مرکز مخابراتی', category: 'telco_hub_node', terms: dictionaries.telcoHubNodes },
    { label: 'سرویس انحصاری', category: 'proprietary_service', terms: dictionaries.proprietaryServices },
  ];

  for (const spec of specs) {
    const terms = [...spec.terms]
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
      .sort((a, b) => b.length - a.length);
    if (terms.length === 0) continue;

    const re = new RegExp(terms.map(termToVariantPattern).join('|'), 'gi');
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(ctx.original)) !== null) {
      hits.push({
        detectorType: 'DICTIONARY',
        ruleId: null,
        ruleLabel: spec.label,
        matchedSpan: { start: match.index, end: match.index + match[0].length, text: match[0] },
        confidence: HIT_CONFIDENCE.DICTIONARY_EXACT,
        category: spec.category,
        sourceRef,
      });
      if (hits.length > 200) break; // safety valve
    }
  }
  return hits;
}

/** Escape a term and tolerate Persian orthography variants. */
function termToVariantPattern(term: string): string {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = '';
  for (const ch of escaped) {
    if (ch === 'ی') pattern += '[یي]';
    else if (ch === 'ک') pattern += '[کك]';
    else if (ch === ' ') pattern += '[\\s\u200C]+';
    else if (ch === '-') pattern += '[\\-\u200C]?';
    else pattern += ch;
  }
  return pattern;
}

/**
 * Compiled-policy deterministic detectors: REGEX and DICTIONARY rules from the
 * active document's compiled rule set. CHECKSUM rules map onto the builtin
 * validators above; SEMANTIC rules match keyword lists.
 */
export function detectCompiledRuleHits(
  ctx: ScanContext,
  rules: Array<{
    id: string;
    detectorType: string;
    regex?: { source: string; flags: string } | null;
    checksumKind?: string | null;
    semantic?: { keywords: string[]; weight: number } | null;
    action?: string;
    priority?: number;
    source?: { documentId?: string; chunkId?: string; page?: number; quote?: string } | null;
  }>,
): DetectionHit[] {
  const hits: DetectionHit[] = [];

  for (const rule of rules) {
    const sourceRef: DetectionHit['sourceRef'] | undefined = rule.source
      ? {
          documentId: rule.source.documentId ?? '',
          chunkId: rule.source.chunkId,
          page: rule.source.page,
        }
      : undefined;

    if (rule.detectorType === 'REGEX' && rule.regex) {
      try {
        pushHits(hits, ctx, {
          detectorType: 'REGEX',
          ruleId: rule.id,
          ruleLabel: 'قاعدهٔ سیاست',
          category: 'policy_regex',
          confidence: HIT_CONFIDENCE.KEYWORD_RULE,
          regex: new RegExp(rule.regex.source, rule.regex.flags),
          sourceRef,
          limit: 3,
        });
      } catch {
        // Invalid stored regex — skip deterministically (never throw).
      }
      continue;
    }

    if (rule.detectorType === 'SEMANTIC' && rule.semantic) {
      for (const kw of rule.semantic.keywords) {
        const idx = ctx.normalized.toLowerCase().indexOf(kw.toLowerCase());
        if (idx !== -1) {
          hits.push({
            detectorType: 'SEMANTIC',
            ruleId: rule.id,
            ruleLabel: 'قاعدهٔ معنایی سیاست',
            matchedSpan: { start: idx, end: idx + kw.length, text: kw },
            confidence: HIT_CONFIDENCE.KEYWORD_RULE,
            category: 'policy_semantic',
            sourceRef,
          });
          break; // one hit per rule is enough
        }
      }
      continue;
    }

    // CHECKSUM rules delegate to the builtin validators.
    if (rule.detectorType === 'CHECKSUM') {
      if (rule.checksumKind === 'IR_NATIONAL_ID') hits.push(...detectNationalIdHits(ctx));
      else if (rule.checksumKind === 'IR_BANK_CARD') hits.push(...detectBankCardHits(ctx));
      else if (rule.checksumKind === 'IBAN') hits.push(...detectIbanHits(ctx));
    }
  }

  return hits;
}
