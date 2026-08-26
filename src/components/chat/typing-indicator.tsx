/** Three-dot "assistant is typing" indicator. */
export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-1" aria-label="در حال نوشتن…">
      <span className="size-2 animate-chat-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.3s]" />
      <span className="size-2 animate-chat-bounce rounded-full bg-muted-foreground/70 [animation-delay:-0.15s]" />
      <span className="size-2 animate-chat-bounce rounded-full bg-muted-foreground/70" />
    </div>
  );
}
