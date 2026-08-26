"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

const MAX_HEIGHT = 200;

export function ChatInput({ onSend, onStop, isStreaming }: ChatInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea up to a maximum height.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !isStreaming;

  const submit = () => {
    if (!canSend) return;
    onSend(value);
    setValue("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t border-border/60 bg-background/80 px-3 py-3 backdrop-blur-md sm:px-4 sm:py-4">
      <div className="mx-auto w-full max-w-3xl">
        <div
          className={cn(
            "relative flex items-end gap-2 rounded-2xl border border-border/80 bg-card p-2 shadow-sm transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/20",
            isStreaming && "opacity-95"
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="سوال خود را بپرسید..."
            disabled={isStreaming}
            aria-label="متن پیام"
            className="chat-scroll max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-3 py-2 text-[0.925rem] leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          />

          {isStreaming ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              className="mb-0.5 size-9 shrink-0 rounded-xl"
              onClick={onStop}
              aria-label="توقف تولید پاسخ"
              title="توقف"
            >
              <Square className="size-4 fill-current" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              className="mb-0.5 size-9 shrink-0 rounded-xl"
              onClick={submit}
              disabled={!canSend}
              aria-label="ارسال پیام"
              title="ارسال (Enter)"
            >
              <ArrowUp className="size-[1.15rem]" />
            </Button>
          )}
        </div>

        <p className="mt-2 text-center text-[11px] text-muted-foreground">
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-sans text-[10px]">Enter</kbd>{" "}
          برای ارسال ·{" "}
          <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-sans text-[10px]">Shift+Enter</kbd>{" "}
          برای خط جدید
        </p>
      </div>
    </div>
  );
}
