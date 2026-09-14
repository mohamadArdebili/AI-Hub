// Local LLM Adapter — Sensitive-Data Layer (prompt §1.3).
//
// INTERFACE + CONTRACT ONLY — no hard dependency on an installed Ollama.
//
// Env contract (all with safe defaults):
//   POLICY_LOCAL_LLM_ENABLED=false   # layer off by default → NoopPolicyLlm
//   OLLAMA_BASE_URL=http://127.0.0.1:11434
//   OLLAMA_POLICY_MODEL=qwen3:8b
//
// Behavior:
//   - POLICY_LOCAL_LLM_ENABLED !== 'true' → NoopPolicyLlm, ZERO network calls.
//   - Enabled but unreachable → availability=false, rules stay PENDING_LLM.
//   - There is NEVER an external-provider fallback for extraction.
//   - Future hookup (after the user installs Ollama and pulls the model):
//       POLICY_LOCAL_LLM_ENABLED=true + correct OLLAMA_* env — no code changes.
//
// All unit tests use an injectable transport — no real network, no Ollama.

import { z } from 'zod';

// ─── Public contracts (prompt §1.3) ─────────────────────────────────────────

export type LocalLlmAvailability =
  | { available: true; model: string; baseUrl: string }
  | {
      available: false;
      reason:
        | 'DISABLED_BY_ENV'
        | 'UNREACHABLE'
        | 'MODEL_NOT_FOUND'
        | 'UNKNOWN';
    };

export interface PolicyRuleExtractionRequest {
  chunkId: string;
  page: number | null;
  text: string;
  languageHint?: 'fa' | 'en' | 'mixed';
  knownKeywords?: string[];
}

export interface ProposedPolicyRule {
  label: string;
  category: string;
  detectorType: 'REGEX' | 'CHECKSUM' | 'DICTIONARY' | 'SEMANTIC';
  /** Mandatory when detectorType === 'REGEX' — validated & compiled before save. */
  regex?: { source: string; flags: string };
  /** Mandatory when detectorType === 'CHECKSUM'. */
  checksumKind?: 'IR_NATIONAL_ID' | 'IR_BANK_CARD' | 'IBAN';
  action: 'BLOCK_EXTERNAL' | 'MASK' | 'FLAG_REVIEW';
  priority: number;
  keywordsHint?: string[];
  confidence: number;
  anchor?: string;
}

export interface PolicyRuleExtractionResult {
  chunkId: string;
  page: number | null;
  /** Short provenance quote from the source chunk — mandatory. */
  sourceQuote: string;
  rules: ProposedPolicyRule[];
  ruleQuotes?: string[];
  rejected: Array<{ reason: string; raw: unknown }>;
  modelUsed: string | null;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface LocalPolicyLlm {
  availability(): Promise<LocalLlmAvailability>;
  extractRules(req: PolicyRuleExtractionRequest): Promise<PolicyRuleExtractionResult>;
}

// ─── Injectable transport (tests never hit the network) ────────────────────

export interface TransportResponse {
  status: number;
  json: unknown;
}

export interface LocalLlmTransport {
  /** Perform a JSON POST and return status + parsed body (throws on network error). */
  postJson(url: string, body: unknown, timeoutMs: number): Promise<TransportResponse>;
  /** Perform a JSON GET and return status + parsed body (throws on network error). */
  getJson(url: string, timeoutMs: number): Promise<TransportResponse>;
}

class FetchTransport implements LocalLlmTransport {
  async postJson(url: string, body: unknown, timeoutMs: number): Promise<TransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  async getJson(url: string, timeoutMs: number): Promise<TransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ─── Env config ─────────────────────────────────────────────────────────────

export function localLlmConfig() {
  return {
    enabled: process.env.POLICY_LOCAL_LLM_ENABLED === 'true',
    baseUrl: (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: process.env.OLLAMA_POLICY_MODEL ?? 'qwen3:1.7b',
    availabilityTimeoutMs: parseInt(
      process.env.OLLAMA_AVAILABILITY_TIMEOUT_MS ?? '2000',
      10,
    ),
    extractionTimeoutMs: parseInt(
      process.env.OLLAMA_EXTRACTION_TIMEOUT_MS ?? '30000',
      10,
    ),
    availabilityCacheTtlMs: 30_000,
  };
}

// ─── Availability cache (short TTL, never throws) ───────────────────────────

let availabilityCache: {
  value: LocalLlmAvailability;
  expiresAt: number;
} | null = null;

/** Reset the cached availability check (used by tests). */
export function resetAvailabilityCache(): void {
  availabilityCache = null;
}

async function checkAvailability(
  transport: LocalLlmTransport,
): Promise<LocalLlmAvailability> {
  const cfg = localLlmConfig();

  if (!cfg.enabled) {
    return { available: false, reason: 'DISABLED_BY_ENV' };
  }

  const now = Date.now();
  if (availabilityCache && availabilityCache.expiresAt > now) {
    return availabilityCache.value;
  }

  let result: LocalLlmAvailability;
  try {
    const res = await transport.getJson(
      `${cfg.baseUrl}/api/tags`,
      cfg.availabilityTimeoutMs,
    );
    const models = (res.json as { models?: Array<{ name?: string }> } | null)?.models;
    const found = Array.isArray(models)
      ? models.some((m) => {
          if (!m?.name) return false;
          return m.name === cfg.model || m.name.startsWith(`${cfg.model}:`);
        })
      : false;

    if (res.status !== 200 || !models) {
      result = { available: false, reason: 'UNKNOWN' };
    } else if (!found) {
      result = { available: false, reason: 'MODEL_NOT_FOUND' };
    } else {
      result = { available: true, model: cfg.model, baseUrl: cfg.baseUrl };
    }
  } catch {
    result = { available: false, reason: 'UNREACHABLE' };
  }

  availabilityCache = { value: result, expiresAt: Date.now() + cfg.availabilityCacheTtlMs };
  return result;
}

// ─── Zod contract for LLM JSON output (prompt §2.2) ─────────────────────────

const proposedRuleSchema = z
  .object({
    label: z.string().min(3).max(120),
    category: z.string().min(2).max(80),
    detectorType: z.enum(['REGEX', 'CHECKSUM', 'DICTIONARY', 'SEMANTIC']),
    regex: z
      .object({ source: z.string().min(1).max(500), flags: z.string().max(10) })
      .optional(),
    checksumKind: z.enum(['IR_NATIONAL_ID', 'IR_BANK_CARD', 'IBAN']).optional(),
    action: z.enum(['BLOCK_EXTERNAL', 'MASK', 'FLAG_REVIEW']),
    priority: z.number().int().min(1).max(1000),
    keywordsHint: z.array(z.string().min(2).max(60)).max(12).optional(),
    confidence: z.number().min(0).max(1),
    anchor: z.string().optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.detectorType === 'REGEX' && !rule.regex) {
      ctx.addIssue({ code: 'custom', message: 'REGEX rule requires regex source' });
    }
    if (rule.detectorType === 'REGEX' && rule.regex) {
      try {
        new RegExp(rule.regex.source, rule.regex.flags);
      } catch {
        ctx.addIssue({ code: 'custom', message: 'invalid JavaScript regex' });
      }
    }
    if (rule.detectorType === 'CHECKSUM' && !rule.checksumKind) {
      ctx.addIssue({ code: 'custom', message: 'CHECKSUM rule requires checksumKind' });
    }
  });

export const EXTRACTION_REJECTION_REASONS = {
  QUOTE_NOT_FOUND_IN_SOURCE: 'QUOTE_NOT_FOUND_IN_SOURCE',
  ANCHOR_NOT_FOUND_IN_SOURCE: 'ANCHOR_NOT_FOUND_IN_SOURCE',
  INVALID_RULE: 'INVALID_RULE',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
} as const;

function cleanWord(w: string): string {
  return w.replace(/[\u200c\-_:،.؛!?"'«»()[\]]/g, '').toLowerCase().trim();
}

function wordSimilarity(w1: string, w2: string): number {
  if (w1 === w2) return 1;
  if (!w1 || !w2) return 0;
  if (w1.includes(w2) || w2.includes(w1)) return 0.8;
  let matches = 0;
  const s1 = new Set(w1);
  for (const c of w2) if (s1.has(c)) matches++;
  return (2 * matches) / (w1.length + w2.length);
}

/**
 * Anchor-based quote resolution: slices a verbatim quote from chunk starting
 * from the anchor phrase, tolerating typos and formatting variations, and
 * stopping before the next rule header.
 */
export function resolveAnchorQuote(chunk: string, anchor: string): string | null {
  if (!chunk || !anchor || !anchor.trim()) return null;
  const anchorWords = anchor.split(/\s+/).map(cleanWord).filter((w) => w.length > 0);
  if (anchorWords.length === 0) return null;

  const tokenRegex = /\S+/g;
  const chunkTokens: Array<{ raw: string; clean: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(chunk)) !== null) {
    chunkTokens.push({
      raw: m[0],
      clean: cleanWord(m[0]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  if (chunkTokens.length === 0) return null;

  let bestScore = 0;
  let bestStartIdx = -1;

  for (let i = 0; i < chunkTokens.length; i++) {
    for (
      let len = Math.max(1, anchorWords.length - 2);
      len <= Math.min(chunkTokens.length - i, anchorWords.length + 4);
      len++
    ) {
      const windowTokens = chunkTokens.slice(i, i + len).filter((t) => t.clean.length > 0);
      let matchedAnchorWords = 0;
      for (const aw of anchorWords) {
        if (windowTokens.some((wt) => wordSimilarity(wt.clean, aw) >= 0.7)) {
          matchedAnchorWords++;
        }
      }
      const score = matchedAnchorWords / anchorWords.length;
      if (score > bestScore) {
        bestScore = score;
        bestStartIdx = i;
      }
    }
  }

  if (bestScore < 0.5 || bestStartIdx === -1) return null;

  const startChar = chunkTokens[bestStartIdx].start;
  const remaining = chunk.slice(startChar);

  // Stop before next «قاعده …» header
  const nextHeaderMatch = remaining.slice(5).search(/\s+قاعده\s+[A-Z0-9_-]+/);
  let endChar = chunk.length;
  if (nextHeaderMatch !== -1) {
    endChar = startChar + 5 + nextHeaderMatch;
  }

  const quote = chunk.slice(startChar, endChar).trim();
  return quote.length > 0 ? quote : null;
}

/**
 * Deterministic post-processing of an LLM extraction response:
 * Supports both v2 anchor-based rules and v1 verbatim sourceQuote.
 * Zod validation per rule (invalid → rejected with reason, never dropped as a whole batch).
 */
export function validateExtractionResponse(
  chunkText: string,
  rawResponse: unknown,
): {
  sourceQuote: string;
  rules: ProposedPolicyRule[];
  ruleQuotes: string[];
  rejected: Array<{ reason: string; raw: unknown }>;
} {
  const rejected: Array<{ reason: string; raw: unknown }> = [];
  const rules: ProposedPolicyRule[] = [];
  const ruleQuotes: string[] = [];

  if (!rawResponse || typeof rawResponse !== 'object') {
    rejected.push({ reason: EXTRACTION_REJECTION_REASONS.MALFORMED_RESPONSE, raw: null });
    return { sourceQuote: '', rules, ruleQuotes, rejected };
  }

  const obj = rawResponse as Record<string, unknown>;
  if (!Array.isArray(obj.rules)) {
    rejected.push({ reason: EXTRACTION_REJECTION_REASONS.MALFORMED_RESPONSE, raw: null });
    return { sourceQuote: '', rules, ruleQuotes, rejected };
  }

  const hasGlobalSourceQuote =
    typeof obj.sourceQuote === 'string' && obj.sourceQuote.trim().length > 0;
  const quote = hasGlobalSourceQuote ? (obj.sourceQuote as string).trim() : '';

  let quoteOk = false;
  if (hasGlobalSourceQuote) {
    const normalizedQuote = quote.replace(/\s+/g, ' ');
    const normalizedChunk = chunkText.replace(/\s+/g, ' ');
    quoteOk = normalizedChunk.includes(normalizedQuote) || chunkText.includes(quote);
  }

  for (const raw of obj.rules) {
    const validated = proposedRuleSchema.safeParse(raw);
    if (!validated.success) {
      rejected.push({ reason: EXTRACTION_REJECTION_REASONS.INVALID_RULE, raw });
      continue;
    }

    const ruleData = validated.data as ProposedPolicyRule;
    if (ruleData.anchor) {
      const resolvedQuote = resolveAnchorQuote(chunkText, ruleData.anchor);
      if (!resolvedQuote) {
        rejected.push({
          reason: EXTRACTION_REJECTION_REASONS.ANCHOR_NOT_FOUND_IN_SOURCE,
          raw,
        });
        continue;
      }
      rules.push(ruleData);
      ruleQuotes.push(resolvedQuote);
    } else {
      // Legacy path with sourceQuote
      if (!quoteOk) {
        rejected.push({
          reason: EXTRACTION_REJECTION_REASONS.QUOTE_NOT_FOUND_IN_SOURCE,
          raw,
        });
        continue;
      }
      rules.push(ruleData);
      ruleQuotes.push(quote);
    }
  }

  return { sourceQuote: quote, rules, ruleQuotes, rejected };
}

// ─── NoopPolicyLlm (default when the layer is disabled) ─────────────────────

export class NoopPolicyLlm implements LocalPolicyLlm {
  async availability(): Promise<LocalLlmAvailability> {
    return { available: false, reason: 'DISABLED_BY_ENV' };
  }

  async extractRules(): Promise<PolicyRuleExtractionResult> {
    return {
      chunkId: '',
      page: null,
      sourceQuote: '',
      rules: [],
      rejected: [],
      modelUsed: null,
    };
  }
}

// ─── OllamaPolicyLlm ────────────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `تو موتور استخراج قاعده از اسناد سیاست امنیت سازمانی هستی.
وظیفه: از متنِ «یک chunk» از سند سیاست، قواعد قابل‌اجرا استخراج کن.

فقط و فقط یک JSON معتبر با این ساختار برگردان — بدون هیچ متن اضافه:
{"sourceQuote": "<نقل‌قول دقیق و کوتاه عیناً از متن chunk>", "rules": [{"label": "<snake_case>", "category": "<snake_case>", "detectorType": "REGEX|CHECKSUM|DICTIONARY|SEMANTIC", "regex": {"source": "...", "flags": "gi"} | undefined, "checksumKind": "IR_NATIONAL_ID|IR_BANK_CARD|IBAN" | undefined, "action": "BLOCK_EXTERNAL|MASK|FLAG_REVIEW", "priority": <1..1000, کمتر = مهم‌تر>, "keywordsHint": ["..."], "confidence": <0..1>}]}

قواعد:
- detectorType=CHECKSUM فقط برای کد ملی/کارت بانکی/شبا (checksumKind الزامی).
- detectorType=REGEX نیاز به regex معتبر JavaScript دارد.
- اگر قاعده‌ای قابل استخراج نیست، rules خالی برگردان — قاعدهٔ بی‌پایه نساز.
- sourceQuote باید عیناً زیررشته‌ای از chunk باشد.`;

export class OllamaPolicyLlm implements LocalPolicyLlm {
  private readonly transport: LocalLlmTransport;

  constructor(transport: LocalLlmTransport = new FetchTransport()) {
    this.transport = transport;
  }

  async availability(): Promise<LocalLlmAvailability> {
    return checkAvailability(this.transport);
  }

  async extractRules(
    req: PolicyRuleExtractionRequest,
  ): Promise<PolicyRuleExtractionResult> {
    const cfg = localLlmConfig();
    const availability = await checkAvailability(this.transport);

    if (!availability.available) {
      // Caller maps this to PENDING_LLM — extraction is skipped, never retried
      // against an external provider (no external fallback exists by design).
      return {
        chunkId: req.chunkId,
        page: req.page,
        sourceQuote: '',
        rules: [],
        rejected: [],
        modelUsed: null,
      };
    }

    try {
      const res = await this.transport.postJson(
        `${cfg.baseUrl}/api/generate`,
        {
          model: availability.model,
          prompt: `${EXTRACTION_SYSTEM_PROMPT}\n\nchunkId: ${req.chunkId}\nصفحه: ${req.page ?? 'نامشخص'}\nزبان: ${req.languageHint ?? 'fa'}\nکلیدواژه‌های شناخته‌شده: ${(req.knownKeywords ?? []).join('، ') || '—'}\n\nمتن chunk:\n"""\n${req.text.slice(0, 3000)}\n"""`,
          format: 'json',
          stream: false,
          options: { temperature: 0 },
        },
        cfg.extractionTimeoutMs,
      );

      if (res.status !== 200) {
        return {
          chunkId: req.chunkId,
          page: req.page,
          sourceQuote: '',
          rules: [],
          rejected: [
            { reason: `HTTP_${res.status}`, raw: null },
          ],
          modelUsed: availability.model,
        };
      }

      const body = res.json as { response?: string } | null;
      let parsedJson: unknown = null;
      try {
        parsedJson = body?.response ? JSON.parse(body.response) : null;
      } catch {
        parsedJson = null;
      }

      const { sourceQuote, rules, ruleQuotes, rejected } = validateExtractionResponse(
        req.text,
        parsedJson,
      );

      return {
        chunkId: req.chunkId,
        page: req.page,
        sourceQuote,
        rules,
        ruleQuotes,
        rejected,
        modelUsed: availability.model,
      };
    } catch (err) {
      return {
        chunkId: req.chunkId,
        page: req.page,
        sourceQuote: '',
        rules: [],
        rejected: [
          {
            reason: err instanceof Error ? err.message : 'EXTRACTION_FAILED',
            raw: null,
          },
        ],
        modelUsed: availability.model,
      };
    }
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

let noopSingleton: NoopPolicyLlm | null = null;

/** Returns the policy LLM per env contract — never throws, never null. */
export function getPolicyLlm(): LocalPolicyLlm {
  if (!localLlmConfig().enabled) {
    noopSingleton ??= new NoopPolicyLlm();
    return noopSingleton;
  }
  return new OllamaPolicyLlm();
}
