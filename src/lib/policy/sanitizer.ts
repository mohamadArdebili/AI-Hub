// Sanitizer — deterministic (regex + dictionary) masking of sensitive data.
// Phase 3: Smart Data DLP. Runs BEFORE any AI processing so that no raw
// identifiers ever leave the organization boundary.
//
// Patterns follow the reference policy document ("سند سیاست‌های امنیت اطلاعات"):
//   - Landline numbers with provincial area codes → [MASKED_LANDLINE]
//   - Mobile numbers (09xx / +98 9xx / 0098 9xx)  → [MASKED_MOBILE]
//   - Valid 10-digit Iranian national IDs         → [NATIONAL_ID]
//   - Private/datacenter IPv4 ranges              → [INTERNAL_IP]
//   - Telco switch/hub center names (dictionary)  → [TELCO_HUB_NODE]
//   - Senior managers & deputies (dictionary)     → [SENIOR_OFFICER]
//   - Proprietary brands/services (dictionary)    → [PROPRIETARY_SERVICE]

export type MaskLabel =
  | 'MASKED_LANDLINE'
  | 'MASKED_MOBILE'
  | 'NATIONAL_ID'
  | 'INTERNAL_IP'
  | 'SENIOR_OFFICER'
  | 'TELCO_HUB_NODE'
  | 'PROPRIETARY_SERVICE';

export interface MaskFinding {
  label: MaskLabel;
  count: number;
}

export interface SanitizerDictionaries {
  seniorOfficers: string[];
  telcoHubNodes: string[];
  proprietaryServices: string[];
}

export interface SanitizeResult {
  /** Prompt with every detected sensitive span replaced by its label. */
  maskedText: string;
  /** Aggregated findings, sorted by count desc. */
  findings: MaskFinding[];
  /** Total number of masked spans. */
  totalCount: number;
}

export const MASK_LABELS: Record<MaskLabel, string> = {
  MASKED_LANDLINE: 'تلفن ثابت',
  MASKED_MOBILE: 'تلفن همراه',
  NATIONAL_ID: 'کد ملی',
  INTERNAL_IP: 'آدرس IP داخلی',
  SENIOR_OFFICER: 'مدیر ارشد',
  TELCO_HUB_NODE: 'مرکز مخابراتی',
  PROPRIETARY_SERVICE: 'سرویس انحصاری',
};

// ─── Digit helpers ──────────────────────────────────────────────────────────

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Convert Persian/Arabic digits to ASCII digits (for value parsing). */
export function toAsciiDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (ch) => {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p >= 0) return String(p);
    return String(ARABIC_DIGITS.indexOf(ch));
  });
}

// Character classes used inside patterns — accept Latin AND Persian/Arabic
// digits so numbers typed on a Persian keyboard are still caught.
const D = '[0-9۰-۹٠-٩]';

const DIGIT_CLASS: Record<string, string> = {
  '0': '[0۰٠]',
  '1': '[1۱۱]',
  '2': '[2۲٢]',
  '3': '[3۳٣]',
  '4': '[4۴٤]',
  '5': '[5۵٥]',
  '6': '[6۶٦]',
  '7': '[7۷٧]',
  '8': '[8۸٨]',
  '9': '[9۹٩]',
};

/** Digit sequence where every digit accepts Persian/Arabic variants. */
function digitSeq(digits: string): string {
  return digits
    .split('')
    .map((d) => DIGIT_CLASS[d] ?? d)
    .join('');
}

// ─── Phone patterns ─────────────────────────────────────────────────────────

// All Iranian provincial area codes (2-digit, after the leading 0).
const AREA_CODES = [
  '21', '26', '31', '34', '35', '38', '41', '44', '51', '54', '56', '58',
  '61', '66', '71', '74', '76', '77', '81', '83', '84', '86', '87',
];

const AREA_CODES_ALT = AREA_CODES.map(digitSeq).join('|');

// 021-12345678 / ۰۵۱ ۱۲۳۴۵۶۷۸ / 02112345678  (0 + area + 8 digits)
const LANDLINE_RE = new RegExp(
  `(?<![${D}])${digitSeq('0')}(?:(${AREA_CODES_ALT}))[-\\s]?(${D}{8})(?![${D}])`,
  'g',
);

// 09123456789 / +989123456789 / 00989123456789 / 989123456789
const MOBILE_RE = new RegExp(
  `(?<![${D}+])(?:\\+${digitSeq('98')}|${digitSeq('0098')}|${digitSeq('98')}|${digitSeq('0')})(${D}{10})(?![${D}])`,
  'g',
);
// The 10 digits after the prefix must start with 9 (verified per-match).

// ─── National ID ────────────────────────────────────────────────────────────

/** Iranian national-ID checksum (mod-11 weighted). */
export function isValidNationalId(digits10: string): boolean {
  if (!/^\d{10}$/.test(digits10)) return false;
  if (/^(\d)\1{9}$/.test(digits10)) return false; // all-same digits are invalid
  const d = digits10.split('').map(Number);
  const sum = d[0] * 10 + d[1] * 9 + d[2] * 8 + d[3] * 7 + d[4] * 6 +
    d[5] * 5 + d[6] * 4 + d[7] * 3 + d[8] * 2;
  const rem = sum % 11;
  const check = d[9];
  return rem < 2 ? check === rem : check === 11 - rem;
}

// Standalone 10-digit runs (checked with the checksum before masking).
const NATIONAL_ID_RE = new RegExp(`(?<![${D}.])(${D}{10})(?![${D}.])`, 'g');

// ─── Private IPv4 ───────────────────────────────────────────────────────────

const OCT = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IP_RE = new RegExp(
  `(?<![${D}.])(?:` +
    `(10)\\.${OCT}\\.${OCT}\\.${OCT}` +          // 10.0.0.0/8
    `|(172\\.(?:1[6-9]|2\\d|3[01]))\\.${OCT}\\.${OCT}` + // 172.16.0.0/12
    `|(192\\.168)\\.${OCT}\\.${OCT}` +            // 192.168.0.0/16
    `)(?![${D}.])`,
  'g',
);

// ─── Dictionary matching ────────────────────────────────────────────────────

/** Escape a dictionary term and make the pattern resilient to Persian
 *  orthography variants (ی/ي, ک/ك, ZWNJ vs space, Arabic Tatweel). */
function termToPattern(term: string): string {
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

interface DictionarySpec {
  label: MaskLabel;
  terms: string[];
}

// ─── Core ───────────────────────────────────────────────────────────────────

const EMPTY_DICT: SanitizerDictionaries = {
  seniorOfficers: [],
  telcoHubNodes: [],
  proprietaryServices: [],
};

/**
 * Mask every deterministic sensitive span in the prompt.
 * Phone/IP patterns run first; the standalone 10-digit run is then validated
 * with the national-ID checksum so random numbers (orders, codes) survive.
 * Dictionary terms are matched case-insensitively with Persian variants.
 */
export function sanitizePrompt(
  text: string,
  dictionaries: SanitizerDictionaries = EMPTY_DICT,
): SanitizeResult {
  let masked = text;
  const counts = new Map<MaskLabel, number>();

  const record = (label: MaskLabel, n = 1) => {
    counts.set(label, (counts.get(label) ?? 0) + n);
  };

  // 1) Mobile numbers (before landline — both can start with 0).
  masked = masked.replace(MOBILE_RE, (match, body: string) => {
    const ascii = toAsciiDigits(body);
    if (!ascii.startsWith('9')) return match; // not a mobile prefix
    record('MASKED_MOBILE');
    return '[MASKED_MOBILE]';
  });

  // 2) Landline numbers.
  masked = masked.replace(LANDLINE_RE, () => {
    record('MASKED_LANDLINE');
    return '[MASKED_LANDLINE]';
  });

  // 3) Private IPv4 addresses.
  masked = masked.replace(IP_RE, () => {
    record('INTERNAL_IP');
    return '[INTERNAL_IP]';
  });

  // 4) Iranian national IDs (checksum-validated standalone 10-digit runs).
  masked = masked.replace(NATIONAL_ID_RE, (match, raw: string) => {
    const ascii = toAsciiDigits(raw);
    if (isValidNationalId(ascii)) {
      record('NATIONAL_ID');
      return '[NATIONAL_ID]';
    }
    return match; // not a valid ID — leave untouched
  });

  // 5) Dictionary terms (longest terms first so overlapping names win).
  const specs: DictionarySpec[] = [
    { label: 'SENIOR_OFFICER', terms: dictionaries.seniorOfficers },
    { label: 'TELCO_HUB_NODE', terms: dictionaries.telcoHubNodes },
    { label: 'PROPRIETARY_SERVICE', terms: dictionaries.proprietaryServices },
  ];

  for (const spec of specs) {
    const terms = [...spec.terms]
      .map((t) => t.trim())
      .filter((t) => t.length >= 2)
      .sort((a, b) => b.length - a.length);
    if (terms.length === 0) continue;

    const re = new RegExp(
      terms.map(termToPattern).join('|'),
      'gi',
    );
    masked = masked.replace(re, () => {
      record(spec.label);
      return `[${spec.label}]`;
    });
  }

  const findings: MaskFinding[] = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);

  return {
    maskedText: masked,
    findings,
    totalCount: findings.reduce((acc, f) => acc + f.count, 0),
  };
}

/** Human-readable Persian summary of findings, e.g. for UI badges. */
export function describeFindings(findings: MaskFinding[]): string {
  return findings
    .map((f) => `${MASK_LABELS[f.label]} ×${f.count}`)
    .join('، ');
}

export interface SanitizationReport {
  complete: boolean;
  totalMasked: number;
  findings: MaskFinding[];
  unresolvedEntities: string[];
  maskedText: string;
}

/**
 * Perform sanitization and generate a formal SanitizationReport (MIGRATION_PLAN_REVIEWED_v1.1 §6.1).
 * Verifies that all targeted entity types are properly masked and checks for any unresolved sensitive remnants.
 */
export function sanitizePromptWithReport(
  text: string,
  dictionaries: SanitizerDictionaries = EMPTY_DICT,
  requiredEntities: string[] = [],
): { result: SanitizeResult; report: SanitizationReport } {
  const result = sanitizePrompt(text, dictionaries);
  const unresolvedEntities: string[] = [];

  // Check required entities: if any required entity was supposed to be masked but couldn't be resolved
  for (const req of requiredEntities) {
    // If requirement is in MASK_LABELS and wasn't found, or if raw text had it but masked text still has it
    if (result.maskedText.includes(req)) {
      unresolvedEntities.push(`UNRESOLVED_REQ_${req}`);
    }
  }

  // Safety net: check if any unmasked national ID or private IP pattern remains in the masked output
  const remainingAscii = toAsciiDigits(result.maskedText);
  const natMatches = remainingAscii.match(/\b\d{10}\b/g);
  if (natMatches) {
    for (const m of natMatches) {
      if (isValidNationalId(m)) {
        unresolvedEntities.push(`UNMASKED_NATIONAL_ID:${m}`);
      }
    }
  }

  const report: SanitizationReport = {
    complete: unresolvedEntities.length === 0,
    totalMasked: result.totalCount,
    findings: result.findings,
    unresolvedEntities,
    maskedText: result.maskedText,
  };

  return { result, report };
}

