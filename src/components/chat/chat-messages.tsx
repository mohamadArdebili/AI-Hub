"use client";

import { useEffect, useRef } from "react";

import { ChatMessage } from "@/components/chat/chat-message";
import type { ChatMessage as ChatMessageType } from "@/lib/chat-types";

interface ChatMessagesProps {
  messages: ChatMessageType[];
}

export function ChatMessages({ messages }: ChatMessagesProps) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest content while streaming / on new messages.
  useEffect(() => {
    const el = endRef.current;
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages]);

  return (
    <div
      ref={containerRef}
      className="chat-scroll flex-1 overflow-y-auto"
      role="log"
      aria-live="polite"
      aria-label="تاریخچه گفت‌وگو"
    >
      <div className="mx-auto w-full max-w-3xl divide-y divide-border/40">
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}
        <div ref={endRef} className="h-4 shrink-0" />
      </div>
    </div>
  );
}
