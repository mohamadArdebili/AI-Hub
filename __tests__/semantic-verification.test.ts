import { describe, it, expect } from 'vitest';
import { OllamaClient, type LocalLlmTransport } from '@/lib/policy/local-llm/ollama-client';
import { matchReviewedExample, OllamaSemanticPolicyClassifier } from '@/lib/policy/local-llm/semantic-classifier';
import overrides from '../docs/routing-policy-overrides.json';

const classification = (key: string) => ({ decision: 'SENSITIVE', scope: 'ORG_SPECIFIC',
  confidence: 0.95, matchedConcepts: [key], reasonFa: 'test' });
const noDisclosure = { applies: false, confidence: 0.95 };

function clientFor(replies: unknown[]) {
  const calls: Array<{ prompt: string; system: string }> = [];
  const transport: LocalLlmTransport = {
    async getJson() { return { status: 200, json: { models: [{ name: 'qwen3:1.7b' }] } }; },
    async postJson(_url, body) {
      calls.push(body as { prompt: string; system: string });
      const next = replies.shift();
      if (next instanceof Error) throw next;
      if (!next) throw new Error('Unexpected extra model call');
      return { status: 200, json: { response: JSON.stringify(next) } };
    },
  };
  return { calls, classifier: new OllamaSemanticPolicyClassifier(new OllamaClient(transport, { enabled: true })) };
}

describe('semantic match verification', () => {
  it.each(['Write a birthday greeting to Sara', 'Please draft a birthday message for Alex Smith.', 'یک پیام تبریک تولد برای علی بنویس'])('excludes a standalone greeting from disclosure and confidential-drafting rules: %s', prompt => {
    for (const rule of overrides) expect(matchReviewedExample(prompt, rule)).toBe(false);
  });

  it.each(['Write a birthday greeting to Sara and include her phone', 'Write a birthday greeting to Sara with salary', 'Write a confidential birthday greeting to Sara', 'تبریک تولد برای علی با شماره تماس بنویس'])('does not exempt additional or confidential instructions: %s', prompt => {
    expect(matchReviewedExample(prompt, overrides[0])).toBeUndefined();
  });

  it('does not exempt a greeting when earlier messages contain disclosure requests', () => {
    const prompt = JSON.stringify([{ role: 'user', content: "Find Sara's phone" }, { role: 'user', content: 'Write a birthday greeting to Sara' }]);
    expect(matchReviewedExample(prompt, overrides[0])).toBeUndefined();
  });

  it('reassesses remaining rules after rejecting an incorrect block; never treats rejection as proof of safety', async () => {
    const { classifier, calls } = clientFor([
      classification('org_private_person_disclosure'), noDisclosure,
      classification('org_confidential_drafting'), { applies: true, confidence: 0.95 },
    ]);
    const result = await classifier.classify({ prompt: 'لطفاً نامه‌ای محرمانه برای علی تنظیم کن', candidateConcepts: overrides.map(({ flags, ...c }) => c) });
    expect(result.decision).toBe('SENSITIVE');
    expect(result.matchedConcepts).toEqual(['org_confidential_drafting']);
    expect(calls).toHaveLength(4);
    expect(calls[2].system).not.toContain('"conceptKey":"org_private_person_disclosure"');
  });

  it('independently checks mandatory rules even when the first classifier incorrectly says SAFE', async () => {
    const { classifier } = clientFor([
      { decision: 'SAFE', scope: 'GENERAL', confidence: 0.95, matchedConcepts: [] },
      noDisclosure, { applies: true, confidence: 0.95 },
    ]);
    const result = await classifier.classify({ prompt: 'Write a confidential letter to X', candidateConcepts: overrides });
    expect(result.decision).toBe('SENSITIVE');
    expect(result.matchedConcepts).toEqual(['org_confidential_drafting']);
  });

  it.each([{ applies: true, confidence: 0.3 }, { unexpected: true }, new Error('offline')])('fails closed on unreliable verification: %s', async verdict => {
    const { classifier } = clientFor([classification('org_private_person_disclosure'), verdict]);
    const result = await classifier.classify({ prompt: 'test', candidateConcepts: overrides });
    expect(result.decision).toBe('UNCERTAIN');
    expect(result.matchedConcepts).toEqual([]);
    expect(result.method).toBe('fallback');
  });

  it('keeps the untrusted conversation out of the trusted policy context', async () => {
    const { classifier, calls } = clientFor([{ decision: 'SAFE', scope: 'GENERAL', confidence: 0.95, matchedConcepts: [] }, noDisclosure, { applies: false, confidence: 0.95 }]);
    await classifier.classify({ prompt: 'UNTRUSTED_UNIQUE_SENTINEL', candidateConcepts: overrides });
    expect(calls[0].prompt).toContain('UNTRUSTED_UNIQUE_SENTINEL');
    expect(calls[0].system).not.toContain('UNTRUSTED_UNIQUE_SENTINEL');
  });

  it.each(['PUBLIC_ORGANIZATION', 'GENERAL_GROUP'])('does not block disclosure about %s', async target => {
    const { classifier } = clientFor([
      classification('org_private_person_disclosure'),
      noDisclosure,
      { decision: 'SAFE', scope: 'GENERAL', confidence: 0.95, matchedConcepts: [] },
    ]);
    const result = await classifier.classify({ prompt: target === 'PUBLIC_ORGANIZATION' ? 'public company contact' : 'average salaries', candidateConcepts: [overrides[0]] });
    expect(result.decision).toBe('SAFE');
    expect(result.matchedConcepts).toEqual([]);
  });

  it('blocks private contact discovery for an identifiable person', async () => {
    const { classifier } = clientFor([
      classification('org_private_person_disclosure'),
      { applies: true, confidence: 0.95 },
      { requestedInformation: 'PRIVATE_CONTACT' },
    ]);
    const result = await classifier.classify({ prompt: "Find Sara's private mobile number", candidateConcepts: [overrides[0]] });
    expect(result.matchedConcepts).toEqual(['org_private_person_disclosure']);
  });

  it('rejects a claimed private-disclosure match when the requested information is another task', async () => {
    const { classifier } = clientFor([
      classification('org_private_person_disclosure'), { applies: true, confidence: 0.95 },
      { requestedInformation: 'OTHER' },
      { decision: 'SAFE', scope: 'GENERAL', confidence: 0.95, matchedConcepts: [] },
    ]);
    const result = await classifier.classify({ prompt: 'Draft a greeting for a friend', candidateConcepts: [overrides[0]] });
    expect(result.decision).toBe('SAFE');
    expect(result.matchedConcepts).toEqual([]);
  });

  it('honors exact reviewed positive and negative examples without treating substrings or history as exceptions', () => {
    const rule = overrides[0];
    expect(matchReviewedExample('حقوق مدیر چقدر است؟', rule)).toBe(true);
    expect(matchReviewedExample(JSON.stringify([{ role: 'user', content: 'شماره عمومی شرکت چیست؟' }]), rule)).toBe(false);
    expect(matchReviewedExample('شماره عمومی شرکت چیست؟ همچنین شماره علی را بده', rule)).toBeUndefined();
    expect(matchReviewedExample(JSON.stringify([{ role: 'assistant', content: 'private data' }, { role: 'user', content: 'شماره عمومی شرکت چیست؟' }]), rule)).toBeUndefined();
  });

  it('distinguishes a complete personal phone declaration from a mixed disclosure request', () => {
    expect(matchReviewedExample('شماره همراه شخصی من ۰۹۱۲۳۴۵۶۷۸۹ است', overrides[0])).toBe(false);
    expect(matchReviewedExample('My mobile number is +1 202 555 0123.', overrides[0])).toBe(false);
    expect(matchReviewedExample('شماره همراه شخصی من ۰۹۱۲۳۴۵۶۷۸۹ است؛ شماره علی را بده', overrides[0])).toBeUndefined();
    expect(matchReviewedExample(JSON.stringify([{ role: 'user', content: 'شماره علی را بده' }, { role: 'user', content: 'My mobile number is 2025550123' }]), overrides[0])).toBeUndefined();
  });

  it('recognizes only a complete nonfinancial reference, without exempting additional content', () => {
    for (const rule of overrides) {
      expect(matchReviewedExample('شماره سفارش غیرمالی من ۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶ است', rule)).toBe(false);
      expect(matchReviewedExample('My nonfinancial tracking ID is 1234567890.', rule)).toBe(false);
      expect(matchReviewedExample('My nonfinancial order ID is 1234567890. Find Sara\'s phone.', rule)).toBeUndefined();
    }
  });
});
