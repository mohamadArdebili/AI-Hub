import type { DetectionHit } from '../types';

/** A greeting addressed only to a name supplies no private facts about that person. */
export function isStandaloneGreetingRequest(text: string): boolean {
  const normalized = text.normalize('NFKC').trim();
  const match = normalized.match(/^(?:please\s+)?(?:write|draft|compose)\s+(?:a\s+)?birthday\s+(?:greeting|message|wish)\s+(?:to|for)\s+([\p{L}]+(?:\s+[\p{L}]+){0,2})[.!]?$/iu)
    ?? normalized.match(/^(?:لطفاً\s+)?(?:یک\s+)?(?:پیام\s+)?تبریک\s+تولد\s+(?:برای|به)\s+([\p{L}]+(?:\s+[\p{L}]+){0,2})\s+بنویس[.!؟]?$/u);
  if (!match) return false;
  // Do not interpret another instruction or a private-data topic as a recipient.
  return !/(?:\b(?:and|with|include|salary|pay|phone|number|email|address|contact|confidential)\b|(?:^|\s)(?:و|با|حقوق|شماره|تماس|تلفن|محرمانه|آدرس)(?:\s|$))/iu.test(match[1]);
}

/** A complete value declaration cannot also be a request to discover another person's data. */
export function isStandalonePersonalContactDeclaration(text: string): boolean {
  const normalized = text.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
    .replace(/[٠-٩]/g, digit => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit))).trim();
  return /^(?:(?:شماره\s*(?:تماس|تلفن|همراه|موبایل)?|تلفن|موبایل|همراه)\s*(?:شخصی\s+)?من\s*(?:[:=]\s*)?\+?[0-9][0-9 ()-]{6,}[0-9]\s*(?:است)?|my\s+(?:personal\s+|private\s+)?(?:phone|mobile)(?:\s+number)?\s*(?:is|:|=)\s*\+?[0-9][0-9 ()-]{6,}[0-9])[.!。]*$/i.test(normalized);
}

export function isStandaloneNonFinancialReference(text: string): boolean {
  return /^(?:شماره\s+(?:سفارش|پیگیری)\s+غیرمالی\s+(?:من\s+)?[0-9۰-۹٠-٩]{6,}\s*(?:است)?|(?:my\s+)?non[- ]?financial\s+(?:order|tracking)\s+(?:number|id)\s*(?:is|:|=)\s*[0-9]{6,})[.!。]*$/i.test(text.trim());
}

/** Explicitly supplied values, not questions about these topics. Offsets are normalized. */
export function detectDeclaredSensitiveHits(normalized: string): DetectionHit[] {
  const hits: DetectionHit[] = [];
  const patterns: Array<{ category: string; label: string; regex: RegExp }> = [
    {
      category: 'credential', label: 'رمز عبور اعلام‌شده',
      regex: /(?:رمز\s*(?:عبور)?|گذرواژه|پسورد|کلید\s*api|توکن\s*دسترسی)\s*(?:(?:من|ما|حساب|سرور)\s*)?(?:[:=]\s*)?([a-z0-9_!@#$%^&*+.-]{4,})/gi,
    },
    {
      category: 'personal_contact', label: 'شماره تماس شخصی اعلام‌شده',
      regex: /(?:(?:شماره\s*(?:تماس|تلفن|همراه|موبایل)?|تلفن|موبایل|همراه)\s*(?:شخصی(?:\s*من)?|من)|(?:my|personal|private)\s+(?:phone|mobile)(?:\s+number)?)\s*(?:is|است|:|=)?\s*(\+?[0-9][0-9 ()-]{6,}[0-9])/gi,
    },
  ];
  for (const { category, label, regex } of patterns) {
    for (const match of normalized.matchAll(regex)) {
      if (/^(?:password|api_key|token|secret)$/i.test(match[1])) continue;
      hits.push({ detectorType: 'REGEX', ruleId: null, ruleLabel: label, category,
        matchedSpan: { start: match.index!, end: match.index! + match[0].length, text: match[0] }, confidence: 0.98 });
    }
  }
  return hits;
}
