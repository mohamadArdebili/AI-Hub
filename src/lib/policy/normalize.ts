// Persian text normalization — standalone, no external dependencies

// Arabic ي (U+064A) → Persian ی (U+06CC)
const ARABIC_YEH = /ي/g;
// Arabic ك (U+0643) → Persian ک (U+06A9)
const ARABIC_KAF = /ك/g;

// Persian digits ۰-۹ (U+06F0-U+06F9)
const PERSIAN_DIGITS: Record<string, string> = {
  '\u06F0': '0',
  '\u06F1': '1',
  '\u06F2': '2',
  '\u06F3': '3',
  '\u06F4': '4',
  '\u06F5': '5',
  '\u06F6': '6',
  '\u06F7': '7',
  '\u06F8': '8',
  '\u06F9': '9',
};

// Arabic-indic digits ٠-٩ (U+0660-U+0669)
const ARABIC_DIGITS: Record<string, string> = {
  '\u0660': '0',
  '\u0661': '1',
  '\u0662': '2',
  '\u0663': '3',
  '\u0664': '4',
  '\u0665': '5',
  '\u0666': '6',
  '\u0667': '7',
  '\u0668': '8',
  '\u0669': '9',
};

// Unicode range for Arabic/Persian letters (simplified)
// We consider a character a "letter" if it falls in common Arabic/Persian Unicode ranges
// or is a Latin letter
function isLetter(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  return (
    // Latin letters
    (cp >= 0x0041 && cp <= 0x005a) ||
    (cp >= 0x0061 && cp <= 0x007a) ||
    // Arabic/Persian letters: U+0621-U+064A, U+0671-U+06D3, U+06D5, U+06E5-U+06E6
    // Persian-specific: U+06CC (farsi yeh), U+06A9 (farsi kef), U+06AF (gaf), U+0698 (zhe), U+0686 (che), U+067E (pe)
    (cp >= 0x0621 && cp <= 0x064A) ||
    (cp >= 0x0671 && cp <= 0x06D3) ||
    cp === 0x06D5 ||
    (cp >= 0x06E5 && cp <= 0x06E6) ||
    (cp >= 0x0698 && cp <= 0x0698) ||
    (cp >= 0x067E && cp <= 0x067E) ||
    (cp >= 0x0686 && cp <= 0x0686) ||
    (cp >= 0x06AF && cp <= 0x06AF) ||
    (cp >= 0x06CC && cp <= 0x06CC) ||
    (cp >= 0x06A9 && cp <= 0x06A9)
  );
}

const ZWNJ = '\u200C';

// Build a single regex that matches all digit characters we want to replace
const ALL_DIGIT_MAP: Record<string, string> = { ...PERSIAN_DIGITS, ...ARABIC_DIGITS };
const DIGIT_REGEX = new RegExp(
  Object.keys(ALL_DIGIT_MAP).map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g',
);

export function normalizePersian(text: string): string {
  if (!text) return '';

  let result = text;

  // 1. Replace Arabic ي → Persian ی
  result = result.replace(ARABIC_YEH, '\u06CC');

  // 2. Replace Arabic ك → Persian ک
  result = result.replace(ARABIC_KAF, '\u06A9');

  // 3. Convert Persian and Arabic digits to Latin digits
  result = result.replace(DIGIT_REGEX, (match) => ALL_DIGIT_MAP[match]);

  // 4. Handle ZWNJ: keep if surrounded by letters on both sides, otherwise remove
  result = result.replace(new RegExp(ZWNJ, 'g'), (_, offset: number) => {
    const before = offset > 0 ? result[offset - 1] : '';
    const after = offset + ZWNJ.length < result.length ? result[offset + ZWNJ.length] : '';
    if (isLetter(before) && isLetter(after)) {
      return ZWNJ; // keep real joiner
    }
    return ''; // remove stray ZWNJ
  });

  // 5. Compress multiple spaces and newlines to single space
  result = result.replace(/[\s\n\r\t]+/g, ' ');

  // 6. Apply Unicode NFKC normalization
  result = result.normalize('NFKC');

  // 7. Trim whitespace
  result = result.trim();

  // 8. Casefold (lowercase)
  result = result.toLowerCase();

  return result;
}
