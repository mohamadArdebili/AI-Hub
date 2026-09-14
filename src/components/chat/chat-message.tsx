"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Check,
  Copy,
  EyeOff,
  Server,
  ShieldAlert,
  User,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { MASK_LABELS } from "@/lib/policy/sanitizer";
import type { ChatMessage as ChatMessageType } from "@/lib/chat-types";

interface ChatMessageProps {
  message: ChatMessageType;
}

function ChatMessageBase({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const isPending = message.pending;
  const isEmpty = !message.content && isPending;
  const isBlocked = message.blocked;

  // Blocked message — special alert card
  if (!isUser && isBlocked) {
    return <BlockedMessage reasons={message.blockedReasons} rules={message.blockedRules} />;
  }

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
          <>
            {message.route === "LOCAL" && (
              <LocalRouteBadge uncertain={message.detection?.decision === "UNCERTAIN"} />
            )}
            {message.maskLabels && message.maskLabels.length > 0 && (
              <MaskNotice findings={message.maskLabels} />
            )}
            <MessageActions text={message.content} errored={Boolean(message.error)} />
          </>
        )}

        {message.error && (
          <p className="text-xs text-destructive">{message.error}</p>
        )}
      </div>

      {isUser && <Avatar role="user" />}
    </div>
  );
}

// ─── Phase 3: mask notice & route badge ─────────────────────────────────────

function MaskNotice({
  findings,
}: {
  findings: Array<{ label: string; count: number }>;
}) {
  const total = findings.reduce((acc, f) => acc + f.count, 0);
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5"
      aria-label={`در پیام شما ${total} مورد داده حساس ماسک شد`}
    >
      <EyeOff className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
        {total} مورد در پیام شما ماسک شد:
      </span>
      {findings.map((f) => (
        <span
          key={f.label}
          className="inline-flex items-center rounded-md border border-amber-500/30 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-300"
        >
          {MASK_LABELS[f.label as keyof typeof MASK_LABELS] ?? f.label} ×{f.count}
        </span>
      ))}
    </div>
  );
}

function LocalRouteBadge({ uncertain }: { uncertain?: boolean }) {
  if (uncertain) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-orange-500/30 bg-orange-500/10 px-2 py-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-300">
        <Server className="size-3" aria-hidden="true" />
        مسیر: امن محلی (تشخیص مبهم — fail-closed)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
      <Server className="size-3" aria-hidden="true" />
      مسیر: مدل محلی — بدون ارسال به سرویس بیرونی
    </span>
  );
}

// ─── Blocked Message Component ─────────────────────────────────────────────

function BlockedMessage({
  reasons,
  rules,
}: {
  reasons?: string[];
  rules?: Array<{ code: string; title: string; severity: string }>;
}) {
  const severityColor: Record<string, string> = {
    CRITICAL: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    HIGH: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20",
    MEDIUM: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20",
    LOW: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
  };

  return (
    <div
      className="mx-auto w-full max-w-[85%] px-4 py-5 sm:max-w-[80%]"
      role="alert"
      aria-live="assertive"
    >
      <div className="animate-chat-fade-in rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
            <ShieldAlert className="size-4 text-destructive" />
          </div>
          <h3 className="text-sm font-semibold text-destructive">
            درخواست مسدود شد
          </h3>
        </div>

        <p className="mb-3 text-sm leading-relaxed text-foreground/80">
          این درخواست بر اساس سیاست‌های سازمان محرمانه تشخیص داده شد و ارسال نشد.
        </p>

        {reasons && reasons.length > 0 && (
          <div className="mb-3 space-y-1">
            {reasons.map((reason, i) => (
              <p key={i} className="text-xs leading-relaxed text-muted-foreground">
                • {reason}
              </p>
            ))}
          </div>
        )}

        {rules && rules.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
          {rules.map((rule) => (
            <span
              key={rule.code}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                severityColor[rule.severity] ?? severityColor.MEDIUM
              )}
            >
              <span className="font-mono">{rule.code}</span>
              <span className="opacity-70">·</span>
              <span>{rule.title}</span>
            </span>
          ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Avatar ─────────────────────────────────────────────────────────────────

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

// ─── Message Actions ────────────────────────────────────────────────────────

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

// ─── Code Block ─────────────────────────────────────────────────────────────

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
