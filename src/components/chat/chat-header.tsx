"use client";

import { useAuthStore } from "@/stores/auth-store";
import { RotateCcw, ShieldCheck, LogOut, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/chat/theme-toggle";

interface ChatHeaderProps {
  onReset: () => void;
  canReset: boolean;
}

export function ChatHeader({ onReset, canReset }: ChatHeaderProps) {
  const { session, setView, logout } = useAuthStore();
  const isAdmin = session?.user?.role === "ADMIN";

  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
        <div className="flex items-center gap-2.5">
          <div className="relative flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <ShieldCheck className="size-[1.15rem]" />
            <span className="absolute -bottom-0.5 -left-0.5 size-2.5 rounded-full border-2 border-background bg-emerald-500" />
          </div>
          <div className="leading-tight">
            <h1 className="text-sm font-semibold tracking-tight">
              Demora AI Hub
            </h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              دستیار امن سازمانی · فاز ۲
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            onClick={onReset}
            disabled={!canReset}
            title="شروع گفت‌وگوی جدید"
          >
            <RotateCcw className="size-4" />
            <span className="hidden sm:inline">گفت‌وگوی جدید</span>
          </Button>
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground"
              onClick={() => setView("admin")}
              title="پنل مدیریت"
            >
              <Settings className="size-4" />
              <span className="hidden sm:inline">مدیریت</span>
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            onClick={logout}
            title="خروج از حساب"
          >
            <LogOut className="size-4" />
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
