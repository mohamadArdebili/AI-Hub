// Policy Embedding Providers & Text Preparation
// (MIGRATION_PLAN_REVIEWED_v1.1 §3.1, spec §16, §17, §0.1 #10)

import crypto from 'crypto';
import { normalizePersian } from '../normalize';
import type { PolicyConcept } from '../concepts/types';

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  getModel(): string;
  getDimensions(): number;
}

export function computeEmbeddingTextHash(text: string): string {
  return crypto.createHash('sha256').update(text.trim()).digest('hex');
}

/**
 * Constructs the rich text payload for generating a concept's embedding vector.
 *
 * SPEC §0.1 #10 REQUIREMENT:
 * Includes conceptKey, name, nameFa, descriptionFa, positiveExamples, conditions, and keywords.
 * NEGATIVE EXAMPLES MUST NOT BE EMBEDDED IN THIS VECTOR!
 * Negative examples are strictly reserved for the semantic judge (LLM) at runtime.
 */
export function buildConceptEmbeddingText(
  concept: Pick<
    PolicyConcept,
    'conceptKey' | 'name' | 'nameFa' | 'descriptionFa' | 'positiveExamples' | 'conditions' | 'keywords'
  >,
): string {
  const parts: string[] = [];

  parts.push(`مفهوم: ${concept.nameFa || concept.name} (${concept.conceptKey})`);
  parts.push(`شرح: ${concept.descriptionFa}`);

  if (concept.positiveExamples && concept.positiveExamples.length > 0) {
    parts.push(`نمونه‌های شمول:\n${concept.positiveExamples.map((ex) => `- ${ex}`).join('\n')}`);
  }

  if (concept.conditions && concept.conditions.length > 0) {
    parts.push(`شروط و استثناها:\n${concept.conditions.map((c) => `- ${c}`).join('\n')}`);
  }

  if (concept.keywords && concept.keywords.length > 0) {
    parts.push(`کلیدواژه‌ها: ${concept.keywords.join('، ')}`);
  }

  return normalizePersian(parts.join('\n\n'));
}

export interface OllamaEmbeddingConfig {
  baseUrl: string;
  model: string;
  timeoutMs: number;
  dimensions?: number;
}

export function defaultOllamaEmbeddingConfig(): OllamaEmbeddingConfig {
  return {
    baseUrl: (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: process.env.POLICY_EMBEDDING_MODEL ?? 'bge-m3',
    timeoutMs: parseInt(process.env.OLLAMA_EMBEDDING_TIMEOUT_MS ?? '3000', 10),
    dimensions: 1024, // Standard bge-m3 dimension
  };
}

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private config: OllamaEmbeddingConfig;

  constructor(config?: Partial<OllamaEmbeddingConfig>) {
    this.config = { ...defaultOllamaEmbeddingConfig(), ...config };
  }

  getModel(): string {
    return this.config.model;
  }

  getDimensions(): number {
    return this.config.dimensions ?? 1024;
  }

  async embed(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      // Use Ollama /api/embeddings endpoint
      const res = await fetch(`${this.config.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          prompt: text,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`Ollama embeddings API returned status ${res.status}`);
      }

      const json = (await res.json()) as { embedding?: number[] };
      if (!json.embedding || !Array.isArray(json.embedding)) {
        throw new Error('Ollama embeddings response missing embedding array');
      }

      this.config.dimensions = json.embedding.length;
      return json.embedding;
    } finally {
      clearTimeout(timer);
    }
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      const vec = await this.embed(text);
      results.push(vec);
    }
    return results;
  }
}

/**
 * Deterministic Mock Embedding Provider for tests and offline validation.
 * Generates unit-norm pseudo-vectors based on token hashes.
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  private model: string;
  private dimensions: number;

  constructor(model: string = 'mock-bge-m3', dimensions: number = 64) {
    this.model = model;
    this.dimensions = dimensions;
  }

  getModel(): string {
    return this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const vector = new Array(this.dimensions).fill(0);
    const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);

    for (const token of tokens) {
      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = (hash << 5) - hash + token.charCodeAt(i);
        hash |= 0;
      }
      const idx = Math.abs(hash) % this.dimensions;
      vector[idx] += 1;
    }

    // Normalize to unit vector (L2 norm)
    const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
    if (norm > 0) {
      return vector.map((v) => v / norm);
    }
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/**
 * Disabled / Fail-Closed Embedding Provider.
 */
export class NoopEmbeddingProvider implements EmbeddingProvider {
  getModel(): string {
    return 'disabled';
  }
  getDimensions(): number {
    return 0;
  }
  async embed(_text: string): Promise<number[]> {
    throw new Error('Embedding provider is disabled or unavailable (fail-closed)');
  }
  async embedBatch(_texts: string[]): Promise<number[][]> {
    throw new Error('Embedding provider is disabled or unavailable (fail-closed)');
  }
}
