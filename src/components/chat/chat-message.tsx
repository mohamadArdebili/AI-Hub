"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Check, Copy, User } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import type { ChatMessage as ChatMessageType } from "@/lib/chat-types";

interface ChatMessageProps {
  message: ChatMessageType;
}

function ChatMessageBase({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isPending = message.pending;
  const isEmpty = !message.content && isPending;

  return (
    <div
      className={cn(
        "group/message flex w-full gap-3 px-4 py-5 sm:gap-4",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && <Avatar role="assistant" />}

      <div
        className={cn(
          "flex min-w-0 max-w-[85%] flex-col gap-1 sm:max-w-[80%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-[0.925rem] leading-relaxed shadow-sm transition-colors",
            isUser
              ? "rounded-tl-md bg-primary text-primary-foreground"
              : "rounded-tr-md bg-muted/60 text-foreground"
          )}
        >
          {isEmpty ? (
            <TypingIndicator />
          ) : isUser ? (
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <div className="chat-markdown">
              <ReactMarkdown
                components={{
                  // Open external links in a new tab safely.
                  a: ({ node: _n, ...props }) => (
                    <a
                      {...props}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-emerald-600 underline-offset-2 hover:underline dark:text-emerald-400"
                    />
                  ),
                  code: ({ node: _n, className, children, ...props }) => {
                    const isInline = !className?.includes("language-");
                    if (isInline) {
                      return (
                        <code
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
                          {...props}
                        >
                          {children}
                        </code>
                      );
                    }
                    return <CodeBlock className={className}>{children}</CodeBlock>;
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
              {isPending && (
                <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-chat-cursor bg-foreground/70" />
              )}
            </div>
          )}
        </div>

        {!isUser && !isPending && message.content && (
          <MessageActions text={message.content} errored={Boolean(message.error)} />
        )}

        {message.error && (
          <p className="text-xs text-destructive">{message.error}</p>
        )}
      </div>

      {isUser && <Avatar role="user" />}
    </div>
  );
}

function Avatar({ role }: { role: "user" | "assistant" }) {
  if (role === "user") {
    return (
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-sm">
        <User className="size-4" />
      </div>
    );
  }
  return (
    <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
      <ShieldSparkIcon className="size-4" />
    </div>
  );
}

function ShieldSparkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3 4 6v6c0 4.5 3.2 7.8 8 9 4.8-1.2 8-4.5 8-9V6l-8-3Z" />
      <path d="m9.5 10 1.8 1.8L15 8.5" />
    </svg>
  );
}

function MessageActions({
  text,
  errored,
}: {
  text: string;
  errored: boolean;
}) {
  const [copied, setCopied] = useState(false);

  if (errored) return null;

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        onClick={onCopy}
      >
        {copied ? (
          <>
            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            کپی شد
          </>
        ) : (
          <>
            <Copy className="size-3.5" />
            کپی
          </>
        )}
      </Button>
    </div>
  );
}

function CodeBlock({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const lang = /language-(\w+)/.exec(className ?? "")?.[1] ?? "code";
  const code = String(children ?? "").replace(/\n$/, "");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="group/code my-3 overflow-hidden rounded-lg border border-border bg-background/60 text-left" dir="ltr">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          {lang}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1.5 px-2 text-[11px] text-muted-foreground"
          onClick={onCopy}
        >
          {copied ? (
            <>
              <Check className="size-3 text-emerald-600 dark:text-emerald-400" />
              کپی شد
            </>
          ) : (
            <>
              <Copy className="size-3" />
              کپی
            </>
          )}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 text-[0.82rem] leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export const ChatMessage = memo(ChatMessageBase);
