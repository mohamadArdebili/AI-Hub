"use client";

import { useCallback, useRef, useState } from "react";
import type { ChatMessage, ChatStreamChunk } from "@/lib/chat-types";
import { authFetch } from "@/lib/api-client";

const SYSTEM_PROMPT =
  "تو یک دستیار هوشمند و حرفه‌ای هستی که به کاربران سازمانی کمک می‌کنی. " +
  "به زبان کاربر (فارسی یا انگلیسی) پاسخ بده و پاسخ‌ها را واضح، دقیق و ساختاریافته ارائه کن. " +
  "در صورت نیاز از فرمت Markdown و بلوک‌های کد استفاده کن.";

let idCounter = 0;
const genId = () => `m_${Date.now()}_${idCounter++}`;

export interface UseChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (text: string) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

/**
 * Manages chat state and consumes the Server-Sent-Events stream from /api/chat.
 * Each assistant reply is appended to progressively as chunks arrive, which
 * produces the ChatGPT-style "typing" experience.
 */
export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    // Finalize any pending message.
    setMessages((prev) =>
      prev.map((m) => (m.pending ? { ...m, pending: false } : m))
    );
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    setMessages([]);
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: ChatMessage = {
      id: genId(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: genId(),
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      pending: true,
    };

    // Build the conversation history to send (including the system prompt).
    const history: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
    ];
    setMessages((prev) => {
      for (const m of prev) {
        if (m.error) continue;
        history.push({ role: m.role, content: m.content });
      }
      history.push({ role: "user", content: trimmed });
      return [...prev, userMsg, assistantMsg];
    });

    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    const assistantId = assistantMsg.id;

    try {
      const res = await authFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => "");
        throw new Error(
          `درخواست ناموفق بود (${res.status}). ${errText.slice(0, 200)}`
        );
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by double newlines.
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine.startsWith("data:")) continue;
            const payload = trimmedLine.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let chunk: ChatStreamChunk;

            try {
              chunk = JSON.parse(payload) as ChatStreamChunk;
            } catch (error) {
              console.warn("Malformed SSE payload:", payload, error);
              continue;
            }

            if (chunk.type === "error") {
              throw new Error(chunk.message ?? "خطای ناشناخته از سمت مدل");
            }

            // ─── Blocked chunk ───────────────────────────────────────────
            if (chunk.type === "blocked") {
              const reasons = chunk.reason
                ? chunk.reason.split("\n").filter(Boolean)
                : [];
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        pending: false,
                        blocked: true,
                        blockedReasons: reasons,
                        blockedRules: chunk.matchedRules,
                      }
                    : message
                )
              );
              continue;
            }

            // ─── Meta chunk (Phase 3 + Sensitive-Data Layer) ─────────────
            if (chunk.type === "meta") {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        route: chunk.route,
                        maskLabels: chunk.maskLabels,
                        classifier: chunk.classifier,
                        detection: chunk.detection,
                      }
                    : message
                )
              );
              continue;
            }

            if (chunk.type === "delta" && chunk.content) {
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        content: message.content + chunk.content,
                      }
                    : message
                )
              );
            }
          }
        }
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, pending: false } : m
        )
      );
    } catch (err) {
      if (controller.signal.aborted) {
        // User stopped generation — keep partial content.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, pending: false } : m
          )
        );
      } else {
        const message =
          err instanceof Error ? err.message : "خطای پیش‌بینی‌نشده رخ داد.";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  pending: false,
                  error: message,
                  content:
                    m.content ||
                    "متأسفانه در دریافت پاسخ خطایی رخ داد. لطفاً دوباره تلاش کنید.",
                }
              : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [isStreaming]);

  return { messages, isStreaming, sendMessage, stop, reset };
}
