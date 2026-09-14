// Shared chat types used across frontend and backend.

export type ChatRole = "user" | "assistant" | "system";

/** Phase 3/6 routing decision (Smart DLP, Prompt Routing & Action Precedence). */
export type ChatRoute = "EXTERNAL" | "EXTERNAL_DIRECT" | "EXTERNAL_MASKED" | "LOCAL" | "BLOCKED";

export interface MaskFindingDto {
  label: string;
  count: number;
}

export interface ClassifierDto {
  isSensitive: boolean;
  category: string;
  riskLevel: string;
  reason: string;
  method: string;
}

/** Sensitive-Data Layer: deterministic detection verdict (for "meta"). */
export interface DetectionDto {
  decision: "SAFE" | "SENSITIVE" | "UNCERTAIN";
  hitLabels: string[];
  method: "deterministic" | "local_llm" | "fallback" | string;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /** True while an assistant message is still being streamed. */
  pending?: boolean;
  /** Set when generating the message failed. */
  error?: string;
  /** True when the message was blocked by the policy engine. */
  blocked?: boolean;
  /** Human-readable reasons for blocking (Persian). */
  blockedReasons?: string[];
  /** Rules that triggered the block. */
  blockedRules?: Array<{ code: string; title: string; severity: string }>;
  /** Phase 3: routing + mask metadata attached via the "meta" chunk. */
  route?: ChatRoute;
  maskLabels?: MaskFindingDto[];
  classifier?: ClassifierDto;
  /** Sensitive-Data Layer: deterministic detection verdict. */
  detection?: DetectionDto;
}

export interface ChatApiRequest {
  messages: { role: ChatRole; content: string }[];
}

/**
 * Server-Sent Events payload emitted by /api/chat.
 * Each chunk carries an incremental piece of the assistant reply.
 */
export interface ChatStreamChunk {
  type: "delta" | "done" | "error" | "blocked" | "meta";
  /** Partial text to append (for "delta"). */
  content?: string;
  /** Full final message id (for "done"). */
  messageId?: string;
  /** Error message (for "error"). */
  message?: string;
  /** Reason for blocking (for "blocked"). */
  reason?: string;
  /** Matched rules (for "blocked"). */
  matchedRules?: Array<{ code: string; title: string; severity: string }>;
  /** Phase 3 routing decision (for "meta"). */
  route?: ChatRoute;
  /** Phase 3 masked findings (for "meta"). */
  maskLabels?: MaskFindingDto[];
  /** Phase 3 classifier verdict (for "meta") — legacy field. */
  classifier?: ClassifierDto;
  /** Sensitive-Data Layer deterministic verdict (for "meta"). */
  detection?: DetectionDto;
}
