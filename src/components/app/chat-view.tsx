"use client";

import { ChatHeader } from "@/components/chat/chat-header";
import { ChatInput } from "@/components/chat/chat-input";
import { ChatMessages } from "@/components/chat/chat-messages";
import { ChatSuggestions } from "@/components/chat/chat-suggestions";
import { useChat } from "@/hooks/use-chat";

export function ChatView() {
  const { messages, isStreaming, sendMessage, stop, reset } = useChat();
  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-[100dvh] flex-col bg-background text-foreground">
      <ChatHeader onReset={reset} canReset={hasMessages} />

      <main className="flex min-h-0 flex-1 flex-col">
        {hasMessages ? (
          <ChatMessages messages={messages} />
        ) : (
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            <ChatSuggestions onPick={sendMessage} disabled={isStreaming} />
          </div>
        )}
      </main>

      <ChatInput onSend={sendMessage} onStop={stop} isStreaming={isStreaming} />
    </div>
  );
}
