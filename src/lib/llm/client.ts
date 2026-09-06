// LLM client abstraction — Phase 3.
//
// Two providers share one OpenAI-compatible interface:
//   - "gapgpt"  : production external LLM (GAPGPT_API_KEY / GAPGPT_BASE_URL)
//   - "zai"     : development fallback available in this sandbox (no key needed)
//
// The security-critical rule is enforced by the ROUTER, not here:
// only prompts classified as General/allowed (and already masked) ever
// reach the external provider.

import ZAI from 'z-ai-web-dev-sdk';

export type LlmProvider = 'gapgpt' | 'zai';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface LlmCompletion {
  content: string;
  usage?: LlmUsage;
}

export type LlmStreamResult =
  | { kind: 'sse'; response: Response } // provider streams SSE (GapGPT)
  | { kind: 'full'; content: string };  // provider returned a complete text

export function getExternalProvider(): LlmProvider {
  return process.env.GAPGPT_API_KEY ? 'gapgpt' : 'zai';
}

function gapgptConfig() {
  return {
    apiKey: process.env.GAPGPT_API_KEY ?? '',
    baseUrl: (
      process.env.GAPGPT_BASE_URL ?? 'https://api.gapgpt.app/v1'
    ).replace(/\/$/, ''),
    model: process.env.GAPGPT_MODEL ?? 'gpt-4o',
  };
}

/** Non-streaming completion — used by the Smart Classifier. */
export async function llmComplete(
  messages: LlmMessage[],
  opts: { timeoutMs?: number; temperature?: number } = {},
): Promise<LlmCompletion> {
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const provider = getExternalProvider();

  if (provider === 'gapgpt') {
    const { apiKey, baseUrl, model } = gapgptConfig();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const details = await res.text().catch(() => '');
        throw new Error(`GapGPT API error (${res.status}): ${details.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const content = data.choices?.[0]?.message?.content ?? '';
      if (!content) throw new Error('GapGPT returned an empty completion');
      return {
        content,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
            }
          : undefined,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // zai development provider
  const zai = await ZAI.create();
  const completion = (await Promise.race([
    zai.chat.completions.create({
      messages,
      thinking: { type: 'disabled' },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('z-ai completion timeout')), timeoutMs),
    ),
  ])) as { choices?: Array<{ message?: { content?: string } }> };

  const content = completion.choices?.[0]?.message?.content ?? '';
  if (!content) throw new Error('z-ai returned an empty completion');
  return { content };
}

/** Streaming chat completion for the EXTERNAL route. */
export async function llmStreamChat(
  messages: LlmMessage[],
  signal?: AbortSignal,
): Promise<LlmStreamResult> {
  const provider = getExternalProvider();

  if (provider === 'gapgpt') {
    const { apiKey, baseUrl, model } = gapgptConfig();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(
        `GapGPT API error (${response.status}): ${details.slice(0, 200)}`
      );
    }
    if (!response.body) throw new Error('GapGPT API did not return a stream body');
    return { kind: 'sse', response };
  }

  // zai development provider — no streaming support; return the full text.
  const zai = await ZAI.create();
  const completion = (await zai.chat.completions.create({
    messages,
    thinking: { type: 'disabled' },
  })) as { choices?: Array<{ message?: { content?: string } }> };
  const content = completion.choices?.[0]?.message?.content ?? '';
  return { kind: 'full', content };
}

/** Rough token estimate (≈4 chars/token) for providers that omit usage. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
