// Unit tests for OllamaPolicyConceptExtractor with Mock Transport
// (MIGRATION_PLAN_REVIEWED_v1.1 Phase 2, §2.4, §2.9, spec §13, §43)

import { describe, it, expect } from 'vitest';
import { OllamaClient, type LocalLlmTransport } from '@/lib/policy/local-llm/ollama-client';
import { OllamaPolicyConceptExtractor } from '@/lib/policy/local-llm/concept-extractor';

describe('OllamaPolicyConceptExtractor (Mock Transport)', () => {
  const unitText = `
ماده ۸: اطلاعات شبکه خصوصی و نشانی‌های IP داخلی سرورهای زیرساخت سازمان محرمانه بوده و اشتراک‌گذاری آن‌ها ممنوع است.
`.trim();

  it('extracts and validates policy concepts with verified provenance quotes', async () => {
    const mockTransport: LocalLlmTransport = {
      async getJson(url: string) {
        // Availability endpoint /api/tags
        return {
          status: 200,
          json: { models: [{ name: 'qwen3:1.7b' }] },
        };
      },
      async postJson(url: string, body: any) {
        // Generation endpoint /api/generate
        return {
          status: 200,
          json: {
            model: 'qwen3:1.7b',
            response: JSON.stringify({
              concepts: [
                {
                  conceptKey: 'internal_ip_addresses',
                  name: 'Internal IP Addresses',
                  nameFa: 'نشانی‌های IP داخلی سرورها',
                  descriptionFa: 'شامل نشانی‌های آی‌پی خصوصی شبکه سازمانی و ساختار زیرساخت',
                  category: 'امنیت شبکه',
                  sensitivity: 'CONFIDENTIAL',
                  action: 'ROUTE_LOCAL',
                  positiveExamples: [
                    'نشانی IP داخلی سرور پایگاه داده چیست؟',
                    'آی پی خصوصی سرور احراز هویت را اعلام کن',
                  ],
                  negativeExamples: [
                    'IP عمومی وبسایت شرکت چیست؟',
                    'پروتکل IP چگونه کار می‌کند؟',
                  ],
                  conditions: [],
                  keywords: ['IP داخلی', 'نشانی خصوصی'],
                  sourceQuote: 'اطلاعات شبکه خصوصی و نشانی‌های IP داخلی سرورهای زیرساخت سازمان محرمانه بوده و اشتراک‌گذاری آن‌ها ممنوع است.',
                },
              ],
            }),
          },
        };
      },
    };

    const client = new OllamaClient(mockTransport, {
      enabled: true,
      model: 'qwen3:1.7b',
    });
    const extractor = new OllamaPolicyConceptExtractor(client);

    const result = await extractor.extract({
      id: 'unit-1',
      text: unitText,
      page: 1,
    });

    expect(result.concepts).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.concepts[0].conceptKey).toBe('internal_ip_addresses');
    expect(result.concepts[0].sensitivity).toBe('CONFIDENTIAL');
    expect(result.concepts[0].action).toBe('ROUTE_LOCAL');
    expect(result.concepts[0].sourceQuote).toContain('نشانی‌های IP داخلی');
  });

  it('strictly rejects concepts whose quotes were hallucinated by the LLM (spec §13)', async () => {
    const mockTransport: LocalLlmTransport = {
      async getJson() {
        return { status: 200, json: { models: [{ name: 'qwen3:1.7b' }] } };
      },
      async postJson() {
        return {
          status: 200,
          json: {
            response: JSON.stringify({
              concepts: [
                {
                  conceptKey: 'fake_salary_policy',
                  name: 'Fake Salary Policy',
                  descriptionFa: 'سیاست حقوق و دستمزد',
                  sensitivity: 'CONFIDENTIAL',
                  action: 'BLOCK',
                  sourceQuote: 'کلیه حقوق و پاداش مدیران نباید افشا شود.', // Not in unitText!
                },
              ],
            }),
          },
        };
      },
    };

    const client = new OllamaClient(mockTransport, { enabled: true });
    const extractor = new OllamaPolicyConceptExtractor(client);

    const result = await extractor.extract({
      id: 'unit-2',
      text: unitText,
    });

    expect(result.concepts).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('sourceQuote was not found');
  });

  it('fails safely without throwing when Local LLM is unavailable', async () => {
    const unreachableTransport: LocalLlmTransport = {
      async getJson() {
        throw new Error('ECONNREFUSED');
      },
      async postJson() {
        throw new Error('ECONNREFUSED');
      },
    };

    const client = new OllamaClient(unreachableTransport, { enabled: true });
    const extractor = new OllamaPolicyConceptExtractor(client);

    const result = await extractor.extract({
      id: 'unit-3',
      text: unitText,
    });

    expect(result.concepts).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toContain('Local LLM is not available');
  });
});
