// Persian PDF-text repair — deterministic, lexicon-guarded (no LLM, no network).
//
// ROOT CAUSE THIS MODULE FIXES
// ─────────────────────────────
// Persian PDFs very often carry a text layer whose ligature glyphs are
// decomposed into TWO characters in REVERSED (visual) order by the PDF's
// ToUnicode CMap:
//     لا (lam+alef)  → ال   e.g. اطلاعات → اطالعات، سلامت → سالمت
//     تر (teh+reh)   → رت   e.g. کنترل → کنرتل، مشتری → مشرتی، دسترسی → دسرتسی
//     تن (teh+noon)  → نت   e.g. متن → منت، داشتن → داشنت، گرفتن → گرفنت
//     بر (reh+beh)   → رب   e.g. معتبر → معترب
// Additionally such extractions float punctuation around as standalone items
// (". شود" instead of "شود.") and sprinkle isolated junk tokens (`, j).
//
// STRATEGY (fail-safe by design)
// ───────────────────────────────
// 1. Word-level: a token is rewritten ONLY when
//      a) the token itself is NOT a known Persian word (lexicon miss), AND
//      b) swapping ONE adjacent ligature-pair yields a known word.
//    Correct words (سال، الف، الگو، منتظر …) are lexicon hits → never touched.
// 2. Punctuation glue: standalone «. ، ؛ : ! ؟» items are attached to the
//    previous token (in RTL visual order the trailing period renders at the
//    left end of the line, so it appears BEFORE the next line in the stream).
// 3. Junk removal: isolated ASCII noise (`, j, single letters) between
//    Persian tokens is dropped. Latin identifiers (API, CDR, SEPEHR-DATA-…)
//    are always preserved.
// 4. Immediate repeated phrases (PDF extraction overlap artifacts) collapse.
//
// Everything is pure + synchronous → fully unit-testable.

import { PERSIAN_LEXICON, LIGATURE_SWAP_PAIRS } from './persian-lexicon';

const ZWNJ = '\u200C';
const PERSIAN_LETTER = /[\u0621-\u064A\u0660-\u06D3\u0671-\u06CC\u06AF\u06A9\u0698\u0686\u067E\u06D5]/;
const PERSIAN_LETTER_G = /[\u0621-\u064A\u0660-\u06D3\u0671-\u06CC\u06AF\u06A9\u0698\u0686\u067E\u06D5]/g;

export interface PersianRepairReport {
  /** total tokens whose text was rewritten (ligature swaps) */
  swappedTokens: number;
  /** per-word replacement counters (from → to, ordered by first occurrence) */
  replacements: Array<{ from: string; to: string; count: number }>;
  /** punctuation tokens glued to the previous word */
  gluedPunctuation: number;
  /** junk tokens removed */
  junkRemoved: number;
  /** collapsed immediate repeated phrases */
  collapsedRepeats: number;
}

export interface PersianRepairResult {
  text: string;
  report: PersianRepairReport;
}

const EMPTY_REPORT: PersianRepairReport = {
  swappedTokens: 0,
  replacements: [],
  gluedPunctuation: 0,
  junkRemoved: 0,
  collapsedRepeats: 0,
};

/** Char-level hygiene applied before token repair (idempotent, lossless). */
function normalizeChars(text: string): string {
  let s = text.normalize('NFKC'); // Arabic presentation forms → standard forms
  s = s.replace(/ي/g, '\u06CC'); // Arabic yeh → Persian yeh
  s = s.replace(/ك/g, '\u06A9'); // Arabic kaf → Persian kef
  s = s.replace(/\u0640{2,}/g, 'ـ'); // long tatweel runs → single tatweel (dash)
  return s;
}

function stripZwnj(s: string): string {
  return s.replace(/\u200C/g, '');
}

/** Generate single-swap candidates at ligature-pair positions only. */
function swapCandidates(token: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < token.length - 1; i++) {
    const pair = token.slice(i, i + 2);
    if (LIGATURE_SWAP_PAIRS.includes(pair)) {
      out.push(token.slice(0, i) + pair[1] + pair[0] + token.slice(i + 2));
    }
  }
  return out;
}

/** Common Persian suffixes stripped (then re-attached) before stem repair. */
const STRIP_SUFFIXES = ['های', 'ها', 'ان', 'ی'];

/**
 * Repair a single (ZWNJ-stripped, Persian-only) token.
 * Returns the repaired token or null when nothing confident was found.
 * Depth-1 = one swap; depth-2 = two swaps (doubly-corrupted words).
 * Suffixed forms (اطالعاتی → اطالعات + ی) are repaired stem-wise.
 */
function repairWord(token: string): string | null {
  if (token.length < 3 || token.length > 32) return null;
  if (!PERSIAN_LETTER.test(token)) return null;
  if (PERSIAN_LEXICON.has(token)) return null; // known → protected

  let best: { word: string; rank: number } | null = null;
  const consider = (cand: string) => {
    const rank = PERSIAN_LEXICON.get(cand);
    if (rank !== undefined && (best === null || rank < best.rank)) {
      best = { word: cand, rank };
    }
  };

  for (const cand of swapCandidates(token)) consider(cand);

  if (!best) {
    for (const mid of swapCandidates(token)) {
      if (PERSIAN_LEXICON.has(mid)) continue;
      for (const cand of swapCandidates(mid)) {
        if (cand === token) continue; // undoing the first swap
        consider(cand);
      }
    }
  }
  if (best) return (best as { word: string }).word;

  // Suffixed token: repair the stem, then re-attach the suffix.
  for (const suffix of STRIP_SUFFIXES) {
    if (!token.endsWith(suffix)) continue;
    const stem = token.slice(0, token.length - suffix.length);
    if (stem.length < 3 || PERSIAN_LEXICON.has(stem)) continue;
    const stemFixed = repairWord(stem);
    if (stemFixed && stemFixed !== stem) return stemFixed + suffix;
  }

  return null;
}

/** Persian-dominant token? (used to decide junk removal) */
function isPersianToken(token: string): boolean {
  const persian = (token.match(PERSIAN_LETTER_G) ?? []).length;
  return persian > 0 && persian >= token.replace(/[\s\u200C]/g, '').length / 2;
}

function isJunkToken(token: string, prev: string | null, next: string | null): boolean {
  // Isolated ASCII noise between Persian context: `, j, ` etc.
  if (token.length === 0 || token.length > 2) return false;
  if (PERSIAN_LETTER.test(token)) return false;
  if (/[0-9۰-۹]/.test(token)) return false;
  const prevFa = prev !== null && isPersianToken(prev);
  const nextFa = next !== null && isPersianToken(next);
  return prevFa || nextFa;
}

const STANDALONE_PUNCT = new Set(['.', '،', '؛', ':', '!', '؟', '..', '...']);

/** Isolated single-letter Latin noise like "j" (never real words here). */
function isLatinNoise(token: string): boolean {
  return (
    /^[a-zA-Z]{1,2}$/.test(token) &&
    token !== 'و'
  );
}

/**
 * Collapse immediate repeated phrases of 3..8 words:
 * "آزمایشی بودن اطلاعات آزمایشی بودن اطلاعات" → single occurrence.
 */
function collapseRepeats(text: string): { text: string; count: number } {
  let out = text;
  let collapses = 0;
  for (let round = 0; round < 3; round++) {
    const tokens = out.split(/(\s+)/); // keep separators
    const words = tokens.filter((t) => t.trim().length > 0);
    const sep = ' ';
    let changed = false;
    for (let len = 8; len >= 3; len--) {
      for (let i = 0; i + 2 * len <= words.length; i++) {
        const a = words.slice(i, i + len).join(sep);
        const b = words.slice(i + len, i + 2 * len).join(sep);
        if (a === b && a.replace(/\s/g, '').length >= 12) {
          words.splice(i + len, len);
          changed = true;
          collapses++;
          break;
        }
      }
      if (changed) break;
    }
    if (!changed) break;
    out = words.join(sep);
  }
  return { text: out, count: collapses };
}

/**
 * Main entry: repair a page/chunk of Persian text extracted from a PDF.
 * Pure function — never throws; unknown tokens simply pass through.
 * LINE-STRUCTURE PRESERVING: the text is processed line by line so
 * paragraph/line breaks survive (downstream header-based rule extraction
 * depends on them).
 */
export function repairPersianText(text: string): PersianRepairResult {
  if (!text || text.trim().length === 0) {
    return { text: text ?? '', report: { ...EMPTY_REPORT } };
  }

  const report: PersianRepairReport = {
    swappedTokens: 0,
    replacements: [],
    gluedPunctuation: 0,
    junkRemoved: 0,
    collapsedRepeats: 0,
  };
  const replacementCounts = new Map<string, { from: string; to: string; count: number }>();

  const lines = normalizeChars(text).split('\n');
  const outLines: string[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) {
      outLines.push('');
      continue;
    }

    // Tokenize keeping separators: word = run of letters/digits/ZWNJ.
    const parts = line.split(/([^\p{L}\p{N}\u200C]+)/u).filter((p) => p !== '');

    // Pass 1: word-level ligature repair.
    const repairedParts: string[] = parts.map((p) => {
      if (!PERSIAN_LETTER.test(p)) return p; // separators, Latin, digits pass through
      const key = stripZwnj(p);
      const fixed = repairWord(key);
      if (fixed === null || fixed === key) return p;
      report.swappedTokens++;
      const entry = replacementCounts.get(key);
      if (entry) entry.count++;
      else replacementCounts.set(key, { from: key, to: fixed, count: 1 });
      return fixed;
    });

    const joined = repairedParts.join('');
    const repairedTokens: string[] = joined.match(/\S+/g) ?? [];

    // Pass 2: glue standalone punctuation to the previous word; drop junk.
    const outTokens: string[] = [];
    for (let i = 0; i < repairedTokens.length; i++) {
      const tok = repairedTokens[i];
      const bare = tok.replace(/[«»()\[\]{}"'٬]/g, '');
      const prev = i > 0 ? repairedTokens[i - 1] : null;
      const next = i < repairedTokens.length - 1 ? repairedTokens[i + 1] : null;

      if (STANDALONE_PUNCT.has(bare) && tok === bare) {
        // Standalone punctuation item → glue to previous token.
        if (outTokens.length > 0) {
          outTokens[outTokens.length - 1] += tok;
          report.gluedPunctuation++;
        }
        continue;
      }

      if (isJunkToken(tok, prev, next) || isLatinNoise(tok)) {
        const prevFa = prev !== null && isPersianToken(prev);
        const nextFa = next !== null && isPersianToken(next);
        if (prevFa || nextFa) {
          report.junkRemoved++;
          continue;
        }
      }

      outTokens.push(tok);
    }

    outLines.push(
      outTokens
        .join(' ')
        .replace(/\s+([،؛!؟])/g, '$1')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    );
  }

  let result = outLines.join('\n').trim();

  // Pass 3: collapse immediate repeated phrases (per line — preserves \n).
  let totalCollapses = 0;
  result = result
    .split('\n')
    .map((line) => {
      const collapsed = collapseRepeats(line);
      totalCollapses += collapsed.count;
      return collapsed.text;
    })
    .join('\n');
  report.collapsedRepeats = totalCollapses;

  report.replacements = Array.from(replacementCounts.values()).slice(0, 40);
  return { text: result, report };
}

/**
 * Quick heuristic — does this text look like it carries ligature-reversal
 * damage? Useful to skip the repair pass for clean TXT sources.
 * Looks for the CORRUPTED signatures only (ال where لا belongs, رت، نت، رب)
 * in words that are NOT known — correct words containing these sequences
 * (سال، منتظر، تربیت …) are lexicon hits and never counted.
 */
export function looksCorrupted(text: string): boolean {
  const tokens = (text.match(/\S+/g) ?? []).slice(0, 400);
  const CORRUPTED_SIGNATURES = ['ال', 'رت', 'نت', 'رب'];
  let unknownWithSignature = 0;
  for (const tok of tokens) {
    const bare = tok.replace(/[^\p{L}\u200C]/gu, '');
    if (bare.length < 3) continue; // too short to signal anything
    if (PERSIAN_LEXICON.has(stripZwnj(bare))) continue;
    if (CORRUPTED_SIGNATURES.some((p) => bare.includes(p))) unknownWithSignature++;
  }
  return unknownWithSignature >= 3;
}
