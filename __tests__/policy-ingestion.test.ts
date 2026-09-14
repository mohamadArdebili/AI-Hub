// Policy ingestion tests — chunking, filters, Zod validation, dedupe/conflict
// All pure functions; no DB, no network, no Ollama (prompt §3).

import { describe, it, expect } from 'vitest';
import {
  chunkPolicyText,
  markCandidates,
  isBoilerplate,
  dedupeProposals,
  flagConflicts,
  proposalIdentityHash,
  compareRuleStrictness,
  compileRulesToRuntime,
  canTransitionLifecycle,
  type RuleProposal,
} from '@/lib/policy/ingestion';
import type { ProposedPolicyRule } from '@/lib/policy/local-llm-adapter';

function makeProposal(
  overrides: Partial<ProposedPolicyRule> = {},
  chunkOrdinal = 0,
): RuleProposal {
  return {
    chunkOrdinal,
    pageIndex: 1,
    sourceQuote: 'اشتراک‌گذاری شمارهٔ ملی کاربران ممنوع است.',
    proposed: {
      label: 'national_id_sharing',
      category: 'national_id',
      detectorType: 'CHECKSUM',
      checksumKind: 'IR_NATIONAL_ID',
      action: 'BLOCK_EXTERNAL',
      priority: 10,
      keywordsHint: ['کد ملی', 'شمارهٔ ملی'],
      confidence: 0.9,
      ...overrides,
    },
  };
}

// ─── Chunking ───────────────────────────────────────────────────────────────

describe('chunkPolicyText — size & overlap contract', () => {
  const longText = 'این یک جملهٔ آزمایشی برای سند سیاست است. '.repeat(120);

  it('produces chunks within the 800–1200 char band (except the last)', () => {
    const chunks = chunkPolicyText([{ page: 1, text: longText }]);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.text.length).toBeLessThanOrEqual(1200);
      expect(chunk.text.length).toBeGreaterThanOrEqual(700); // boundary tolerance
    }
  });

  it('keeps page provenance per chunk', () => {
    // Large pages so chunks genuinely START inside each page.
    const pageA = Array.from({ length: 60 }, (_, i) => `بند ${i + 1} صفحهٔ اول با توضیح کامل سیاست امنیتی سازمان. `).join('');
    const pageB = Array.from({ length: 60 }, (_, i) => `بند ${i + 1} صفحهٔ دوم با الزامات دسترسی و افشا. `).join('');
    const chunks = chunkPolicyText([
      { page: 1, text: pageA },
      { page: 2, text: pageB },
    ]);
    const pages = new Set(chunks.map((c) => c.pageIndex));
    expect(pages.has(1)).toBe(true);
    expect(pages.has(2)).toBe(true);
  });

  it('assigns stable hashes and sequential ordinals with spans', () => {
    // Varied (non-periodic) sentences — identical slices would be a false
    // duplicate otherwise.
    const longText = Array.from(
      { length: 120 },
      (_, i) => `بند شمارهٔ ${i + 1} الزام امنیتی سند سیاست است. `,
    ).join('');
    const chunks = chunkPolicyText([{ page: null, text: longText }]);
    const hashes = new Set(chunks.map((c) => c.textHash));
    expect(hashes.size).toBe(chunks.length); // unique per distinct content
    chunks.forEach((c, i) => {
      expect(c.ordinal).toBe(i);
      expect(c.spanStart).toBeLessThan(c.spanEnd);
    });
  });

  it('is deterministic — same input → identical hashes', () => {
    const a = chunkPolicyText([{ page: 1, text: longText }]);
    const b = chunkPolicyText([{ page: 1, text: longText }]);
    expect(a.map((c) => c.textHash)).toEqual(b.map((c) => c.textHash));
  });
});

// ─── Deterministic filters ──────────────────────────────────────────────────

describe('deterministic filters', () => {
  it('marks very short fragments as boilerplate', () => {
    expect(isBoilerplate('صفحهٔ ۳')).toBe(true);
    expect(isBoilerplate('12 / 34')).toBe(true);
  });

  it('marks repeated header/footer runs as boilerplate', () => {
    const header = 'سند سیاست‌های امنیت اطلاعات — نسخهٔ ۱';
    const text = Array(5).fill(header).join('\n');
    expect(isBoilerplate(text)).toBe(true);
  });

  it('marks policy-keyword chunks as candidates', () => {
    const chunks = chunkPolicyText([
      { page: 1, text: 'اشتراک‌گذاری شمارهٔ ملی کاربران ممنوع است. '.repeat(30) },
    ]);
    markCandidates(chunks);
    expect(chunks[0].isCandidate).toBe(true);
  });

  it('never marks boilerplate as candidate', () => {
    const chunks = chunkPolicyText([{ page: 1, text: 'ممنوع — صفحه ۲' }]);
    markCandidates(chunks);
    expect(chunks[0].isBoilerplate).toBe(true);
    expect(chunks[0].isCandidate).toBe(false);
  });
});

// ─── Dedupe ─────────────────────────────────────────────────────────────────

describe('dedupeProposals', () => {
  it('flags the second identical proposal as DUPLICATE', () => {
    const verdicts = dedupeProposals([makeProposal(), makeProposal({}, 1)]);
    expect(verdicts[0].verdict.kind).toBe('ACCEPT');
    expect(verdicts[1].verdict).toEqual({
      kind: 'DUPLICATE',
      of: 'national_id_sharing',
    });
    expect(verdicts[0].identityHash).toBe(verdicts[1].identityHash);
  });

  it('keeps distinct proposals', () => {
    const verdicts = dedupeProposals([
      makeProposal(),
      makeProposal({ label: 'iban_leak', category: 'iban', detectorType: 'CHECKSUM', checksumKind: 'IBAN' }),
    ]);
    expect(verdicts.every((v) => v.verdict.kind === 'ACCEPT')).toBe(true);
    expect(proposalIdentityHash(verdicts[0].proposal)).not.toBe(
      proposalIdentityHash(verdicts[1].proposal),
    );
  });
});

// ─── Conflict ───────────────────────────────────────────────────────────────

describe('flagConflicts', () => {
  it('groups overlapping-scope rules with different actions', () => {
    const accepted = [
      {
        proposal: makeProposal({ action: 'BLOCK_EXTERNAL', keywordsHint: ['کد ملی'] }),
        identityHash: 'h1',
      },
      {
        proposal: makeProposal({ action: 'MASK', label: 'mask_nid', keywordsHint: ['کد ملی', 'هویت'] }),
        identityHash: 'h2',
      },
    ];
    const groups = flagConflicts(accepted);
    expect(groups.size).toBe(2);
    expect(groups.get('0')).toBe(groups.get('1'));
  });

  it('ignores same-action or disjoint-scope pairs', () => {
    const same = flagConflicts([
      {
        proposal: makeProposal({ action: 'BLOCK_EXTERNAL' }),
        identityHash: 'a',
      },
      {
        proposal: makeProposal({ action: 'BLOCK_EXTERNAL', label: 'other' }),
        identityHash: 'b',
      },
    ]);
    expect(same.size).toBe(0);

    const disjoint = flagConflicts([
      {
        proposal: makeProposal({ keywordsHint: ['کد ملی'] }),
        identityHash: 'c',
      },
      {
        proposal: makeProposal({ label: 'other', keywordsHint: ['مناقصه'] }),
        identityHash: 'd',
      },
    ]);
    expect(disjoint.size).toBe(0);
  });
});

describe('compareRuleStrictness — explicit priority rule', () => {
  it('prefers higher strictness (BLOCK_EXTERNAL > MASK > FLAG_REVIEW)', () => {
    expect(
      compareRuleStrictness(
        { action: 'BLOCK_EXTERNAL', priority: 50, scopeSize: 3 },
        { action: 'MASK', priority: 10, scopeSize: 1 },
      ),
    ).toBeLessThan(0);
  });

  it('prefers narrower scope at equal strictness', () => {
    expect(
      compareRuleStrictness(
        { action: 'MASK', priority: 50, scopeSize: 1 },
        { action: 'MASK', priority: 10, scopeSize: 4 },
      ),
    ).toBeLessThan(0);
  });

  it('falls back to the priority field', () => {
    expect(
      compareRuleStrictness(
        { action: 'MASK', priority: 5, scopeSize: 2 },
        { action: 'MASK', priority: 10, scopeSize: 2 },
      ),
    ).toBeLessThan(0);
  });
});

// ─── Lifecycle ──────────────────────────────────────────────────────────────

describe('canTransitionLifecycle', () => {
  it('allows DRAFT → REVIEW → ACTIVE and archiving', () => {
    expect(canTransitionLifecycle('DRAFT', 'REVIEW')).toBe(true);
    expect(canTransitionLifecycle('REVIEW', 'ACTIVE')).toBe(true);
    expect(canTransitionLifecycle('ACTIVE', 'ARCHIVED')).toBe(true);
    expect(canTransitionLifecycle('DRAFT', 'ARCHIVED')).toBe(true);
    expect(canTransitionLifecycle('REVIEW', 'DRAFT')).toBe(true);
  });

  it('rejects invalid jumps', () => {
    expect(canTransitionLifecycle('DRAFT', 'ACTIVE')).toBe(false);
    expect(canTransitionLifecycle('ARCHIVED', 'ACTIVE')).toBe(false);
    expect(canTransitionLifecycle('ACTIVE', 'DRAFT')).toBe(false);
  });
});

// ─── Compile ────────────────────────────────────────────────────────────────

describe('compileRulesToRuntime', () => {
  it('compiles and priority-sorts valid rules', () => {
    const { compiled, skipped } = compileRulesToRuntime('doc-1', [
      {
        id: 'r2',
        detectorType: 'SEMANTIC',
        keywords: ['صورتجلسه'],
        action: 'BLOCK_EXTERNAL',
        priority: 20,
        sourceDocumentId: 'doc-1',
      },
      {
        id: 'r1',
        detectorType: 'CHECKSUM',
        checksumKind: 'IR_NATIONAL_ID',
        action: 'BLOCK_EXTERNAL',
        priority: 5,
        sourceDocumentId: 'doc-1',
      },
    ]);
    expect(skipped).toHaveLength(0);
    expect(compiled.map((c) => c.id)).toEqual(['r1', 'r2']); // priority asc
    expect(compiled[0].checksumKind).toBe('IR_NATIONAL_ID');
  });

  it('skips invalid regex rules without crashing activation', () => {
    const { compiled, skipped } = compileRulesToRuntime('doc-1', [
      {
        id: 'bad',
        detectorType: 'REGEX',
        regexSource: '([unclosed',
        regexFlags: 'g',
        action: 'MASK',
        priority: 10,
        sourceDocumentId: 'doc-1',
      },
      {
        id: 'good',
        detectorType: 'REGEX',
        regexSource: '\\b\\d{4}\\b',
        regexFlags: 'g',
        action: 'MASK',
        priority: 10,
        sourceDocumentId: 'doc-1',
      },
    ]);
    expect(compiled.map((c) => c.id)).toEqual(['good']);
    expect(skipped).toEqual([{ id: 'bad', reason: 'invalid regex source' }]);
  });

  it('carries provenance (page/quote/chunk) into the compiled rule', () => {
    const { compiled } = compileRulesToRuntime('doc-1', [
      {
        id: 'p1',
        detectorType: 'SEMANTIC',
        keywords: ['مناقصه'],
        action: 'FLAG_REVIEW',
        priority: 30,
        sourceDocumentId: 'doc-1',
        sourcePage: 7,
        sourceQuote: 'مناقصات محرمانه است',
        sourceChunkId: 'chunk-9',
      },
    ]);
    expect(compiled[0].source).toMatchObject({
      documentId: 'doc-1',
      page: 7,
      chunkId: 'chunk-9',
      quote: 'مناقصات محرمانه است',
    });
  });
});
