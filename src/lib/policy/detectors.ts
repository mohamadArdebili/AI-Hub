// Detection layers — standalone, no Next.js imports

import type { RuleInput, ChunkInput, DetectionResult, MatchedRule } from './types';

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
      regex: /\bhost\s*=\s*\S+.*(?:port|password)\s*=\s*\S+/gis,
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
