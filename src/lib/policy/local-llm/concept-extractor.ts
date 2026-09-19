// Policy Concept Extractor — Local LLM Implementation
// (MIGRATION_PLAN_REVIEWED_v1.1 §2.4, spec §12, §13, §43, §71 Phase 2)

import { extractExplicitRule, isPolicyMetadata } from '../ingestion/explicit-rule-extractor';
import { OllamaClient } from './ollama-client';
import { validateExtractedConcepts, type ExtractedConcept } from '../concepts/validator';
import { filterConceptsByProvenance } from '../ingestion/provenance';

export interface ConceptExtractionUnitInput {
  id?: string;
  text: string;
  sectionTitle?: string | null;
  page?: number | null;
}

export interface PolicyConceptExtractionResult {
  unitId?: string;
  concepts: ExtractedConcept[];
  rejected: Array<{ data: unknown; reason: string }>;
  rawResponse?: string;
  modelUsed?: string;
}

export interface PolicyConceptExtractor {
  extract(unit: ConceptExtractionUnitInput): Promise<PolicyConceptExtractionResult>;
}

export const CONCEPT_EXTRACTION_SYSTEM_PROMPT = `
شما یک تحلیل‌گر خبره امنیت اطلاعات و حاکمیت داده سازمانی هستید.
وظیفه شما استخراج مفاهیم سیاست امنیتی (PolicyConcept) از متن داده‌شده از سند سیاست سازمان است.

قوانین حیاتی و غیرقابل نقض:
۱. فقط و فقط بر اساس متن داده‌شده استخراج کنید؛ هیچ قاعده‌ای را حدس نزنید یا جعل نکنید.
۲. فیلد sourceQuote الزامی است و باید عیناً یک نقل‌قول معتبر از داخل متن باشد (کپی دقیق).
۳. خروجی باید یک JSON معتبر شامل آرایه concepts باشد.
۴. هر مفهوم باید شامل فیلدهای زیر باشد:
   - conceptKey: شناسه یکتای انگلیسی با حروف کوچک و underscore (مانند: employee_personal_phone)
   - name: عنوان کوتاه انگلیسی (مانند: Employee Personal Phone)
   - nameFa: عنوان کوتاه فارسی
   - descriptionFa: شرح دقیق مفهوم و دامنه شمول آن به فارسی
   - category: دسته موضوعی (مانند: اطلاعات پرسنلی، امنیت شبکه، اسرار تجاری)
   - sensitivity: یکی از موارد روبرو: PUBLIC, INTERNAL, CONFIDENTIAL, HIGHLY_CONFIDENTIAL
   - action: یکی از موارد روبرو: ALLOW_EXTERNAL, ROUTE_LOCAL, MASK_AND_ALLOW_EXTERNAL, BLOCK
   - positiveExamples: حداقل ۲ نمونه پرامپت فارسی که مشمول این محدودیت می‌شوند
   - negativeExamples: حداقل ۲ نمونه پرامپت فارسی ظاهراً مشابه که مجاز هستند و نباید بلاک شوند
   - conditions: شروط یا استثناهای ذکرشده در متن (در صورت عدم وجود آرایه خالی [])
   - keywords: کلیدواژه‌های شاخص داخل متن
   - sourceQuote: نقل‌قول دقیق از متن که مبنای استخراج این مفهوم است
۵. اگر متن ورودی بیش از یک سطح حساسیت/اقدام مجزا را توصیف می‌کند (مثلاً چند ردیف از یک جدول سطوح یا چند قاعدهٔ پشت‌سرهم)، برای هر سطح/قاعده یک «مفهوم» جداگانه با conceptKey و sourceQuote مخصوص به خودش تولید کن. هرگز چند قاعده را در یک مفهوم واحد ادغام نکن.
۶. تعاریف ALLOW_EXTERNAL، LOCAL_ONLY و BLOCKED و توضیح هدف سند به تنهایی مفهوم محدودکننده نیستند. LOCAL_ONLY یعنی ROUTE_LOCAL، نه BLOCK. استثناها و نفی‌ها را عیناً در conditions حفظ کن. شناسه مفهوم باید با موضوع متن مطابقت داشته باشد.
۷. sourceQuote باید کوتاه‌ترین بخش کافیِ متن باشد که مستقیماً مبنای همان یک مفهوم است — معمولاً یک جمله یا کمتر، نه کل واحد متنی ورودی.
`.trim();

export function buildConceptExtractionPrompt(unit: ConceptExtractionUnitInput): string {
  return `
${unit.sectionTitle ? `عنوان بخش سند: ${unit.sectionTitle}\n` : ''}متن ورودی از سند سیاست امنیتی:
---
${unit.text}
---

بر اساس متن فوق، مفاهیم سیاست را استخراج کرده و فقط در قالب JSON زیر پاسخ دهید:
(توجه: مقدار sourceQuote باید عیناً و کلمه‌به‌کلمه از داخل «متن ورودی از سند سیاست امنیتی» بالا باشد، بدون عنوان بخش):
{
  "concepts": [
    {
      "conceptKey": "...",
      "name": "...",
      "nameFa": "...",
      "descriptionFa": "...",
      "category": "${unit.sectionTitle || 'امنیتی'}",
      "sensitivity": "CONFIDENTIAL",
      "action": "ROUTE_LOCAL",
      "positiveExamples": ["..."],
      "negativeExamples": ["..."],
      "conditions": [],
      "keywords": ["..."],
      "sourceQuote": "..."
    }
  ]
}
`.trim();
}

export class OllamaPolicyConceptExtractor implements PolicyConceptExtractor {
  private client: OllamaClient;

  constructor(client?: OllamaClient) {
    this.client = client ?? new OllamaClient();
  }

  async extract(unit: ConceptExtractionUnitInput): Promise<PolicyConceptExtractionResult> {
    if (isPolicyMetadata(unit.text, unit.sectionTitle)) {
      return { unitId: unit.id, concepts: [], rejected: [], modelUsed: 'structured-policy' };
    }
    const explicit = extractExplicitRule(unit.text, unit.page);
    if (explicit) return { unitId: unit.id, concepts: explicit, rejected: [], modelUsed: 'structured-policy' };
    const availability = await this.client.checkAvailability();
    if (!availability.available) {
      return {
        unitId: unit.id,
        concepts: [],
        rejected: [
          {
            data: null,
            reason: `Local LLM is not available (${availability.reason})`,
          },
        ],
      };
    }

    const prompt = buildConceptExtractionPrompt(unit);

    let rawResponse = '';
    try {
      const gen = await this.client.generate(prompt, {
        system: CONCEPT_EXTRACTION_SYSTEM_PROMPT,
        temperature: 0.1,
      });
      rawResponse = gen.response;
    } catch (err) {
      return {
        unitId: unit.id,
        concepts: [],
        rejected: [
          {
            data: null,
            reason: `Ollama generate call failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
      };
    }

    // 1. Zod schema validation
    const { valid: schemaValid, rejected: schemaRejected } = validateExtractedConcepts(
      rawResponse,
      {
        sourceText: unit.text,
        requireProvenanceInSourceText: true,
      },
    );

    // 2. Strict Provenance filter (spec §13)
    const { accepted, rejected: provenanceRejected } = filterConceptsByProvenance(
      schemaValid,
      unit,
    );

    const allRejected = [
      ...schemaRejected,
      ...provenanceRejected.map((r) => ({ data: r.concept, reason: r.reason })),
    ];

    return {
      unitId: unit.id,
      concepts: accepted,
      rejected: allRejected,
      rawResponse,
      modelUsed: availability.model,
    };
  }
}
