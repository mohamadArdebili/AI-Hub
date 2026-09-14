// Normalize tests — Persian/Arabic digits, ZWNJ, NFKC (prompt §3)

import { describe, it, expect } from 'vitest';
import { normalizePersian } from '@/lib/policy/normalize';

describe('normalizePersian — digits', () => {
  it('converts Persian digits to ASCII', () => {
    expect(normalizePersian('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
  });

  it('converts Arabic-Indic digits to ASCII', () => {
    expect(normalizePersian('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('normalizes numbers inside Persian sentences', () => {
    const out = normalizePersian('شماره ۰۹۱۲۳۴۵۶۷۸۹ را بررسی کن');
    expect(out).toContain('09123456789');
  });
});

describe('normalizePersian — letters', () => {
  it('unifies Arabic yeh (ي) into Persian yeh (ی)', () => {
    expect(normalizePersian('شي')).toBe(normalizePersian('شی'));
  });

  it('unifies Arabic kaf (ك) into Persian kaf (ک)', () => {
    expect(normalizePersian('كود')).toBe(normalizePersian('کود'));
  });

  it('casefolds Latin letters', () => {
    expect(normalizePersian('HeLLo')).toBe('hello');
  });
});

describe('normalizePersian — ZWNJ and spacing', () => {
  it('keeps ZWNJ between letters (real joiner)', () => {
    const out = normalizePersian('می\u200Cروم');
    expect(out).toContain('\u200C');
  });

  it('removes stray ZWNJ not between letters', () => {
    const out = normalizePersian('سلام \u200C دنیا');
    expect(out).not.toContain('\u200C');
  });

  it('collapses whitespace, newlines and tabs into single spaces', () => {
    expect(normalizePersian('a\n\nb\tc   d')).toBe('a b c d');
  });

  it('trims the result', () => {
    expect(normalizePersian('  متن  ')).toBe('متن');
  });
});

describe('normalizePersian — unicode stability', () => {
  it('is NFKC-stable (idempotent)', () => {
    const input = 'ﺍﻓﻐﺎﻥ ﮎﺪ ۱۲۳'; // presentation forms + Persian digits
    const once = normalizePersian(input);
    expect(normalizePersian(once)).toBe(once);
  });

  it('maps different digit scripts of the same number to identical output', () => {
    expect(normalizePersian('۱۲۳۴')).toBe(normalizePersian('١٢٣٤'));
    expect(normalizePersian('۱۲۳۴')).toBe(normalizePersian('1234'));
  });
});
