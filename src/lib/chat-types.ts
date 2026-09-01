// Shared chat types used across frontend and backend.

export type ChatRole = "user" | "assistant" | "system";

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
}

export interface ChatApiRequest {
  messages: { role: ChatRole; content: string }[];
}

/**
 * Server-Sent Events payload emitted by /api/chat.
 * Each chunk carries an incremental piece of the assistant reply.
 */
export interface ChatStreamChunk {
  type: "delta" | "done" | "error" | "blocked";
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
}
