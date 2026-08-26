"use client";

import { Code2, FileText, Languages, Sparkles } from "lucide-react";

interface ChatSuggestionsProps {
  onPick: (text: string) => void;
  disabled?: boolean;
}

const SUGGESTIONS: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  prompt: string;
}[] = [
  {
    icon: Code2,
    title: "توضیح یک مفهوم برنامه‌نویسی",
    prompt: "تفاوت بین REST و GraphQL را با مثال توضیح بده.",
  },
  {
    icon: FileText,
    title: "خلاصه‌سازی متن",
    prompt: "یک متن طولانی را به‌صورت خلاصه و ساختاریافته برایم بازنویسی کن.",
  },
  {
    icon: Languages,
    title: "ترجمه",
    prompt: "این متن را به انگلیسی ترجمه کن: «هوش مصنوعی آینده کسب‌وکار را متحول می‌کند.»",
  },
  {
    icon: Sparkles,
    title: "ایده‌پردازی",
    prompt: "پنج ایده خلاقانه برای بهبود تجربه کاربری یک سایت فروشگاهی پیشنهاد بده.",
  },
];

export function ChatSuggestions({ onPick, disabled }: ChatSuggestionsProps) {
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-10 text-center">
      <div className="relative mb-5 flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-md">
        <Sparkles className="size-7" />
        <span className="absolute -bottom-1 -left-1 size-3.5 rounded-full border-2 border-background bg-emerald-500" />
      </div>
      <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
        چطور می‌تونم کمکت کنم؟
      </h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        سوال خودت را بنویس یا یکی از پیشنهادهای زیر را انتخاب کن. پاسخ‌ها به‌صورت
        زنده و مرحله‌به‌مرحله نمایش داده می‌شوند.
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map(({ icon: Icon, title, prompt }) => (
          <button
            key={title}
            type="button"
            disabled={disabled}
            onClick={() => onPick(prompt)}
            className="group flex items-start gap-3 rounded-xl border border-border/70 bg-card p-3.5 text-right transition-all hover:border-border hover:bg-accent/50 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
              <Icon className="size-[1.05rem]" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{title}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">
                {prompt}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
