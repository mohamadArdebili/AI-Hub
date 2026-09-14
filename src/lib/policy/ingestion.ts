// Policy Ingestion core — Sensitive-Data Layer (prompt §1.1/§1.2).
//
// Pure, DB-free functions so the whole ingestion pipeline is independently
// unit-testable (prompt §3 policy-ingestion.test.ts):
//   extractPdfPages  → page-aware text extraction (in pdf-processor.ts)
//   chunkPolicyText  → 800–1200 chars, 15–20% overlap, stable hash, provenance
//   deterministic filters (boilerplate drop + candidate keyword marking)
//   dedupeProposals / flagConflicts (stable hashes, explicit priority rule)
//   canTransitionLifecycle (DRAFT → REVIEW → ACTIVE, ARCHIVED)
//   compileRulesToRuntime (regex pre-compilation, priority sort)

import crypto from 'crypto';
import { normalizePersian } from './normalize';
import type { CompiledPolicyRule } from './types';
import type { ProposedPolicyRule } from './local-llm-adapter';

// ─── Chunking ───────────────────────────────────────────────────────────────

export const CHUNK_MIN_CHARS = 800;
export const CHUNK_MAX_CHARS = 1200;
export const CHUNK_OVERLAP_RATIO = 0.17; // 15–20% band midpoint

/** Configurable candidate-keyword list (env override supported). */
export function candidateKeywords(): string[] {
  const fromEnv = process.env.POLICY_CANDIDATE_KEYWORDS;
  if (fromEnv) {
    const list = fromEnv.split(',').map((k) => k.trim()).filter(Boolean);
    if (list.length > 0) return list;
  }
  return [
    'ممنوع', 'محرمانه', 'نباید', 'مجاز نیست', 'باید', 'الزام', 'اجباری',
    'طبقه‌بندی', 'سرّی', 'سری', 'دسترسی', 'افشا', 'انتشار', 'اشتراک‌گذاری',
    'کد ملی', 'شماره کارت', 'شبا', 'رمز', ' backup', 'لاگ', 'CDR',
    'ریز مکالمات', 'صورتجلسه', 'قرارداد', 'مناقصه', 'بودجه',
  ];
}

export interface SourcePage {
  page: number | null;
  text: string;
}

export interface ChunkDraft {
  ordinal: number;
  pageIndex: number | null;
  text: string;
  textHash: string;
  spanStart: number;
  spanEnd: number;
  isCandidate: boolean;
  isBoilerplate: boolean;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Chunk page-tagged text into 800–1200 char windows with 15–20% overlap.
 * Provenance: each chunk keeps the page it started on plus its char span in
 * the full concatenated text. Hash is sha256 of the exact chunk text (stable
 * identity for dedupe).
 */
export function chunkPolicyText(pages: SourcePage[]): ChunkDraft[] {
  // Concatenate with page boundary markers so we can map offsets → pages.
  const joined: string[] = [];
  const pageStarts: Array<{ page: number | null; start: number; end: number }> = [];
  let cursor = 0;
  for (const p of pages) {
    const text = p.text.replace(/\s+\n/g, '\n').trim();
    if (!text) continue;
    joined.push(text);
    const start = cursor;
    cursor += text.length + 1; // +1 for the joining newline
    pageStarts.push({ page: p.page, start, end: cursor });
  }
  const fullText = joined.join('\n');

  if (fullText.length === 0) return [];

  const overlap = Math.round(CHUNK_MIN_CHARS * CHUNK_OVERLAP_RATIO);
  const drafts: ChunkDraft[] = [];
  let spanStart = 0;
  let ordinal = 0;

  while (spanStart < fullText.length) {
    let spanEnd = Math.min(spanStart + CHUNK_MAX_CHARS, fullText.length);

    // Prefer a sentence/paragraph boundary inside [min, max] when possible.
    if (spanEnd < fullText.length) {
      const minEnd = spanStart + CHUNK_MIN_CHARS;
      const window = fullText.slice(spanStart, spanEnd);
      const breakers = /(?<=[.!؟?؛;\u06D4])\s|\n/g;
      let bestEnd = -1;
      let m: RegExpExecArray | null;
      breakers.lastIndex = 0;
      while ((m = breakers.exec(window)) !== null) {
        const candidate = spanStart + m.index + m[0].length;
        if (candidate >= minEnd) {
          bestEnd = candidate; // keep the LAST boundary inside the window
        }
      }
      if (bestEnd > spanStart + 200) spanEnd = bestEnd;
    }

    const text = fullText.slice(spanStart, spanEnd).trim();
    if (text.length > 0) {
      const page =
        pageStarts.find((p) => spanStart >= p.start && spanStart < p.end)?.page ?? null;
      drafts.push({
        ordinal,
        pageIndex: page,
        text,
        textHash: sha256(text),
        spanStart,
        spanEnd,
        isCandidate: false,
        isBoilerplate: isBoilerplate(text),
      });
      ordinal++;
    }

    if (spanEnd >= fullText.length) break;
    // Advance with overlap; guarantee forward progress.
    spanStart = Math.max(spanEnd - overlap, spanStart + 1);
  }

  return drafts;
}

// ─── Deterministic filters (run BEFORE any LLM, always) ────────────────────

/**
 * Boilerplate detector: headers/footers/repeated page numbers/very short
 * fragments. Pure heuristic, deterministic.
 */
export function isBoilerplate(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 40) return true;

  // Pure page-number / digit-punctuation runs.
  const digitish = trimmed.replace(/[0-9\s\-–—/().،,:؛|صفحه]/g, '');
  if (digitish.length / trimmed.length < 0.2) return true;

  // Repetitive header/footer lines: a line repeated 3+ times inside the chunk.
  const lines = trimmed.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 3) {
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(l, (counts.get(l) ?? 0) + 1);
    const maxRepeat = Math.max(...counts.values());
    if (maxRepeat >= 3 && maxRepeat / lines.length > 0.5) return true;
  }

  return false;
}

/**
 * Candidate marking: chunks mentioning at least one policy keyword become
 * candidates for rule extraction (deterministic keyword filter).
 */
export function markCandidates(chunks: ChunkDraft[], keywords?: string[]): ChunkDraft[] {
  const kws = keywords ?? candidateKeywords();
  for (const chunk of chunks) {
    if (chunk.isBoilerplate) {
      chunk.isCandidate = false;
      continue;
    }
    const normalized = normalizePersian(chunk.text);
    chunk.isCandidate = kws.some((kw) => normalized.includes(normalizePersian(kw)));
  }
  return chunks;
}

// ─── Rule proposal post-processing: dedupe + conflict ──────────────────────

export interface RuleProposal {
  chunkOrdinal: number;
  pageIndex: number | null;
  chunkId?: string;
  sourceQuote: string;
  proposed: ProposedPolicyRule;
}

export type ProposalVerdict =
  | { kind: 'ACCEPT' }
  | { kind: 'DUPLICATE'; of: string }
  | { kind: 'CONFLICT'; group: string };

/**
 * Stable identity hash of a proposed rule: normalized label + detector +
 * pattern/checksum/keywords. Same detector + same identity → duplicate.
 */
export function proposalIdentityHash(p: RuleProposal): string {
  const rule = p.proposed;
  const parts = [
    rule.label.toLowerCase().replace(/[\s\u200C]+/g, '_'),
    rule.detectorType,
    rule.detectorType === 'REGEX' ? rule.regex?.source ?? '' : '',
    rule.checksumKind ?? '',
    (rule.keywordsHint ?? []).join('|').toLowerCase(),
  ];
  return sha256(parts.join('§'));
}

/**
 * Dedupe pass: identical proposals (same stable hash) are flagged as
 * duplicates of the first occurrence — deterministic, order-stable.
 */
export function dedupeProposals(
  proposals: RuleProposal[],
): Array<{ proposal: RuleProposal; identityHash: string; verdict: ProposalVerdict }> {
  const seen = new Map<string, string>(); // hash → first label
  return proposals.map((proposal) => {
    const identityHash = proposalIdentityHash(proposal);
    const firstLabel = seen.get(identityHash);
    if (firstLabel) {
      return {
        proposal,
        identityHash,
        verdict: { kind: 'DUPLICATE', of: firstLabel } as ProposalVerdict,
      };
    }
    seen.set(identityHash, proposal.proposed.label);
    return { proposal, identityHash, verdict: { kind: 'ACCEPT' } as ProposalVerdict };
  });
}

/**
 * Conflict pass: two rules whose keyword scopes overlap but whose actions
 * differ are flagged into a shared conflictGroup. Priority rule (explicit,
 * documented): the rule with the HIGHER strictness (action
 * BLOCK_EXTERNAL > MASK > FLAG_REVIEW) and the NARROWER scope (fewer
 * keywords) wins at runtime; compilation sorts by priority ascending.
 */
const ACTION_STRICTNESS: Record<string, number> = {
  BLOCK_EXTERNAL: 3,
  MASK: 2,
  FLAG_REVIEW: 1,
};

export function flagConflicts(
  accepted: Array<{ proposal: RuleProposal; identityHash: string }>,
): Map<string, string> {
  const groups = new Map<string, string>(); // index → conflictGroup

  for (let i = 0; i < accepted.length; i++) {
    for (let j = i + 1; j < accepted.length; j++) {
      const a = accepted[i].proposal.proposed;
      const b = accepted[j].proposal.proposed;
      if (a.action === b.action) continue;

      const ka = new Set((a.keywordsHint ?? []).map((k) => k.toLowerCase()));
      const kb = new Set((b.keywordsHint ?? []).map((k) => k.toLowerCase()));
      if (ka.size === 0 || kb.size === 0) continue;

      const overlap = [...ka].some((k) => kb.has(k));
      if (!overlap) continue;

      const group = sha256(`${accepted[i].identityHash}~${accepted[j].identityHash}`).slice(0, 16);
      groups.set(String(i), group);
      groups.set(String(j), group);
    }
  }
  return groups;
}

/** Runtime tie-break: higher strictness first, then narrower scope, then priority. */
export function compareRuleStrictness(
  a: { action: string; priority: number; scopeSize: number },
  b: { action: string; priority: number; scopeSize: number },
): number {
  const strictDiff = (ACTION_STRICTNESS[b.action] ?? 0) - (ACTION_STRICTNESS[a.action] ?? 0);
  if (strictDiff !== 0) return strictDiff;
  const scopeDiff = a.scopeSize - b.scopeSize; // narrower scope first
  if (scopeDiff !== 0) return scopeDiff;
  return a.priority - b.priority;
}

// ─── Lifecycle (prompt §1.2: DRAFT → REVIEW → ACTIVE, ARCHIVED) ────────────

export type LifecycleState = 'DRAFT' | 'REVIEW' | 'ACTIVE' | 'ARCHIVED';

const LIFECYCLE_TRANSITIONS: Record<LifecycleState, LifecycleState[]> = {
  DRAFT: ['REVIEW', 'ARCHIVED'],
  REVIEW: ['ACTIVE', 'DRAFT'],
  ACTIVE: ['ARCHIVED'],
  ARCHIVED: [],
};

/** Deterministic transition check — the single source of truth for the API. */
export function canTransitionLifecycle(from: LifecycleState, to: LifecycleState): boolean {
  return (LIFECYCLE_TRANSITIONS[from] ?? []).includes(to);
}

// ─── Compile (prompt §1.2: activation compiles runtime-optimized rules) ────

export interface CompilableRule {
  id: string;
  detectorType: 'REGEX' | 'CHECKSUM' | 'DICTIONARY' | 'SEMANTIC';
  regexSource?: string | null;
  regexFlags?: string | null;
  checksumKind?: string | null;
  dictionaryId?: string | null;
  keywords?: string[];
  action: 'BLOCK_EXTERNAL' | 'MASK' | 'FLAG_REVIEW';
  priority: number;
  sourceDocumentId: string | null;
  sourceChunkId?: string | null;
  sourcePage?: number | null;
  sourceQuote?: string | null;
}

/**
 * Compile DB rules into the runtime-optimized format: regex validated and
 * carried pre-compiled-ready, keyword sets frozen, sorted by priority.
 * Invalid regex rules are skipped (never crash activation) and reported.
 */
export function compileRulesToRuntime(
  documentId: string,
  rules: CompilableRule[],
): { compiled: CompiledPolicyRule[]; skipped: Array<{ id: string; reason: string }> } {
  const compiled: CompiledPolicyRule[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const rule of rules) {
    if (rule.detectorType === 'REGEX') {
      if (!rule.regexSource) {
        skipped.push({ id: rule.id, reason: 'REGEX rule missing source' });
        continue;
      }
      try {
        new RegExp(rule.regexSource, rule.regexFlags ?? 'gi');
      } catch {
        skipped.push({ id: rule.id, reason: 'invalid regex source' });
        continue;
      }
      compiled.push({
        id: rule.id,
        detectorType: 'REGEX',
        regex: { source: rule.regexSource, flags: rule.regexFlags ?? 'gi' },
        action: rule.action,
        priority: rule.priority,
        source: {
          documentId: rule.sourceDocumentId ?? documentId,
          chunkId: rule.sourceChunkId ?? undefined,
          page: rule.sourcePage ?? undefined,
          quote: rule.sourceQuote ?? '',
        },
      });
      continue;
    }

    if (rule.detectorType === 'CHECKSUM') {
      if (!rule.checksumKind) {
        skipped.push({ id: rule.id, reason: 'CHECKSUM rule missing kind' });
        continue;
      }
      compiled.push({
        id: rule.id,
        detectorType: 'CHECKSUM',
        checksumKind: rule.checksumKind,
        action: rule.action,
        priority: rule.priority,
        source: {
          documentId: rule.sourceDocumentId ?? documentId,
          chunkId: rule.sourceChunkId ?? undefined,
          page: rule.sourcePage ?? undefined,
          quote: rule.sourceQuote ?? '',
        },
      });
      continue;
    }

    if (rule.detectorType === 'DICTIONARY') {
      compiled.push({
        id: rule.id,
        detectorType: 'DICTIONARY',
        dictionaryId: rule.dictionaryId ?? undefined,
        action: rule.action,
        priority: rule.priority,
        source: {
          documentId: rule.sourceDocumentId ?? documentId,
          chunkId: rule.sourceChunkId ?? undefined,
          page: rule.sourcePage ?? undefined,
          quote: rule.sourceQuote ?? '',
        },
      });
      continue;
    }

    // SEMANTIC — frozen keyword set.
    const keywords = (rule.keywords ?? []).filter((k) => k.trim().length > 0);
    if (keywords.length === 0) {
      skipped.push({ id: rule.id, reason: 'SEMANTIC rule missing keywords' });
      continue;
    }
    compiled.push({
      id: rule.id,
      detectorType: 'SEMANTIC',
      semantic: { keywords, scope: ['chat'], weight: rule.priority },
      action: rule.action,
      priority: rule.priority,
      source: {
        documentId: rule.sourceDocumentId ?? documentId,
        chunkId: rule.sourceChunkId ?? undefined,
        page: rule.sourcePage ?? undefined,
        quote: rule.sourceQuote ?? '',
      },
    });
  }

  // Priority sort: lower number = higher precedence.
  compiled.sort((a, b) => a.priority - b.priority);
  return { compiled, skipped };
}
