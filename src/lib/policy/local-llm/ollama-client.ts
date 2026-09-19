// Ollama Client — Transport, Availability, and Generation
// (MIGRATION_PLAN_REVIEWED_v1.1 §2.3, spec §13, §43, §71 Phase 2)

export type LocalLlmAvailability =
  | { available: true; model: string; baseUrl: string }
  | {
      available: false;
      reason:
        | 'DISABLED_BY_ENV'
        | 'UNREACHABLE'
        | 'MODEL_NOT_FOUND'
        | 'UNKNOWN';
    };

export interface TransportResponse {
  status: number;
  json: unknown;
}

export interface LocalLlmTransport {
  postJson(url: string, body: unknown, timeoutMs: number): Promise<TransportResponse>;
  getJson(url: string, timeoutMs: number): Promise<TransportResponse>;
}

export class FetchTransport implements LocalLlmTransport {
  async postJson(url: string, body: unknown, timeoutMs: number): Promise<TransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }

  async getJson(url: string, timeoutMs: number): Promise<TransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      const json = await res.json().catch(() => null);
      return { status: res.status, json };
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface OllamaClientConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  availabilityTimeoutMs: number;
  extractionTimeoutMs: number;
  classifierTimeoutMs: number;
  availabilityCacheTtlMs: number;
}

export function defaultOllamaConfig(): OllamaClientConfig {
  return {
    enabled: process.env.POLICY_LOCAL_LLM_ENABLED === 'true',
    baseUrl: (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: process.env.OLLAMA_POLICY_MODEL ?? 'qwen3:1.7b',
    availabilityTimeoutMs: parseInt(process.env.OLLAMA_AVAILABILITY_TIMEOUT_MS ?? '2000', 10),
    extractionTimeoutMs: parseInt(process.env.OLLAMA_EXTRACTION_TIMEOUT_MS ?? '30000', 10),
    classifierTimeoutMs: parseInt(process.env.POLICY_CLASSIFIER_TIMEOUT_MS ?? '5000', 10),
    availabilityCacheTtlMs: 30_000,
  };
}

export interface GenerateOptions {
  temperature?: number;
  think?: boolean;
  maxTokens?: number;
  format?: 'json' | string | Record<string, unknown>;
  system?: string;
  timeoutMs?: number;
}

export interface GenerateResult {
  response: string;
  model: string;
  totalDurationNs?: number;
  promptEvalCount?: number;
  evalCount?: number;
}

export class OllamaClient {
  private transport: LocalLlmTransport;
  private config: OllamaClientConfig;
  private availabilityCache: { value: LocalLlmAvailability; expiresAt: number } | null = null;

  constructor(transport?: LocalLlmTransport, config?: Partial<OllamaClientConfig>) {
    this.transport = transport ?? new FetchTransport();
    this.config = { ...defaultOllamaConfig(), ...config };
  }

  resetCache(): void {
    this.availabilityCache = null;
  }

  getConfig(): OllamaClientConfig {
    return { ...this.config };
  }

  async checkAvailability(timeoutMs?: number): Promise<LocalLlmAvailability> {
    if (!this.config.enabled) {
      return { available: false, reason: 'DISABLED_BY_ENV' };
    }

    const now = Date.now();
    if (this.availabilityCache && this.availabilityCache.expiresAt > now) {
      return this.availabilityCache.value;
    }

    let result: LocalLlmAvailability;
    try {
      const url = `${this.config.baseUrl}/api/tags`;
      const res = await this.transport.getJson(url, Math.min(timeoutMs ?? this.config.availabilityTimeoutMs, this.config.availabilityTimeoutMs));

      if (res.status !== 200 || !res.json || typeof res.json !== 'object') {
        result = { available: false, reason: 'UNREACHABLE' };
      } else {
        const body = res.json as { models?: Array<{ name?: string }> };
        const models = Array.isArray(body.models)
          ? body.models.map((m) => (m.name ?? '').toLowerCase())
          : [];

        const targetModel = this.config.model.toLowerCase();
        const baseTarget = targetModel.split(':')[0];

        const match = models.some(
          (m) => m === targetModel || m.startsWith(`${targetModel}:`) || m.split(':')[0] === baseTarget,
        );

        if (match) {
          result = {
            available: true,
            model: this.config.model,
            baseUrl: this.config.baseUrl,
          };
        } else {
          result = { available: false, reason: 'MODEL_NOT_FOUND' };
        }
      }
    } catch {
      result = { available: false, reason: 'UNREACHABLE' };
    }

    this.availabilityCache = {
      value: result,
      expiresAt: now + this.config.availabilityCacheTtlMs,
    };
    return result;
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<GenerateResult> {
    const timeout = options.timeoutMs ?? this.config.extractionTimeoutMs;
    // UTF-8 bytes are a conservative upper bound on byte-level tokenizer tokens.
    // Refuse oversized contexts instead of allowing Ollama to truncate old messages.
    const contextTokens = 16384;
    if (options.maxTokens && Buffer.byteLength(prompt + (options.system ?? ''), 'utf8') + options.maxTokens + 1024 > contextTokens) {
      throw new Error('CLASSIFIER_CONTEXT_TOO_LARGE');
    }
    const body: Record<string, unknown> = {
      model: this.config.model,
      prompt,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.1,
        ...(process.env.OLLAMA_NUM_GPU !== undefined && /^\d+$/.test(process.env.OLLAMA_NUM_GPU)
          ? { num_gpu: Number(process.env.OLLAMA_NUM_GPU) } : {}),
        ...(options.maxTokens ? { num_predict: options.maxTokens, num_ctx: contextTokens } : {}),
      },
    };

    if (options.think !== undefined) body.think = options.think;
    if (options.format) {
      body.format = options.format;
    }
    if (options.system) {
      body.system = options.system;
    }

    const url = `${this.config.baseUrl}/api/generate`;
    const res = await this.transport.postJson(url, body, timeout);

    if (res.status !== 200 || !res.json || typeof res.json !== 'object') {
      throw new Error(`Ollama generate failed with status ${res.status}`);
    }

    const data = res.json as {
      response?: string;
      model?: string;
      total_duration?: number;
      prompt_eval_count?: number;
      eval_count?: number;
    };

    return {
      response: data.response ?? '',
      model: data.model ?? this.config.model,
      totalDurationNs: data.total_duration,
      promptEvalCount: data.prompt_eval_count,
      evalCount: data.eval_count,
    };
  }
}
