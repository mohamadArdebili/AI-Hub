import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { runDetection } from '../src/lib/policy/detection-pipeline';
import { classifyPrompt } from '../src/lib/policy/classifier';

describe('Phase 0 Security Invariants', () => {
  it('Property 1 & 3: No file under src/lib/policy imports @/lib/llm/client', () => {
    const policyDir = path.resolve(__dirname, '../src/lib/policy');
    const files = fs.readdirSync(policyDir).filter((f) => f.endsWith('.ts'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(policyDir, file), 'utf8');
      expect(content).not.toContain('@/lib/llm/client');
      expect(content).not.toContain("from '../llm/client'");
      expect(content).not.toContain('llmComplete');
    }
  });

  it('Property 2: classifyPrompt runs purely deterministically without network/LLM', async () => {
    const res = await classifyPrompt('این یک متن تست است');
    expect(res.method).toBe('heuristic');
    expect(typeof res.isSensitive).toBe('boolean');
    expect(typeof res.riskLevel).toBe('string');
  });

  it('Property 3 & 5: runDetection always reports externalLlmInvoked === false', async () => {
    const outcome = await runDetection({
      prompt: 'سلام، لطفاً در مورد برنامه‌نویسی توضیح دهید',
      compiledRules: [],
      dictionaries: {
        seniorOfficers: [],
        telcoHubNodes: [],
        proprietaryServices: [],
      },
    });

    expect(outcome.processing.externalLlmInvoked).toBe(false);
    expect(outcome.processing.localLlmUsed).toBe(false);
  });

  it('Property 4: Inconsistent timeout budget fails closed to UNCERTAIN/LOCAL_ONLY', async () => {
    const prevDetection = process.env.POLICY_DETECTION_TIMEOUT_MS;
    const prevClassifier = process.env.POLICY_CLASSIFIER_TIMEOUT_MS;

    try {
      // Intentionally invalid timeout configuration: detection < classifier
      process.env.POLICY_DETECTION_TIMEOUT_MS = '2000';
      process.env.POLICY_CLASSIFIER_TIMEOUT_MS = '8000';

      const outcome = await runDetection({
        prompt: 'تست شکست بودجه زمانی',
        compiledRules: [],
        dictionaries: {
          seniorOfficers: [],
          telcoHubNodes: [],
          proprietaryServices: [],
        },
      });

      expect(outcome.decision).toBe('UNCERTAIN');
      expect(outcome.action).toBe('LOCAL_ONLY');
      expect(outcome.reason).toContain('پیکربندی مهلت زمانی');
    } finally {
      process.env.POLICY_DETECTION_TIMEOUT_MS = prevDetection;
      process.env.POLICY_CLASSIFIER_TIMEOUT_MS = prevClassifier;
    }
  });
});
