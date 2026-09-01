"use client";

import { useState } from "react";
import { ShieldCheck, Loader2, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/stores/auth-store";

export function LoginView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginSuccess = useAuthStore((s) => s.loginSuccess);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("لطفاً ایمیل و رمز عبور را وارد کنید");
      return;
    }

    setIsLoading(true);

    try {
      // Compact login: ONE request validates credentials, returns the user in
      // the body, and sets a tiny DB-backed session cookie. The session token
      // is also returned for cookieless environments (embedded previews with
      // third-party cookies blocked) where the cookie is never stored.
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
        cache: "no-store",
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.user) {
        setError(data?.error || "ایمیل یا رمز عبور اشتباه است");
        return;
      }

      loginSuccess(data.user, typeof data.sessionToken === "string" ? data.sessionToken : null);
    } catch {
      setError("خطا در برقراری ارتباط با سرور");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-chat-fade-in">
        {/* Branding */}
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="relative flex size-14 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
            <ShieldCheck className="size-7" />
            <span className="absolute -bottom-0.5 -left-0.5 size-3 rounded-full border-2 border-background bg-emerald-500" />
          </div>
          <div className="text-center leading-tight">
            <h1 className="text-xl font-bold tracking-tight">
              Demora AI Hub
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              دروازه امن هوش مصنوعی سازمانی
            </p>
          </div>
        </div>

        <Card className="border-border/60">
          <CardHeader className="pb-4 text-center">
            <CardTitle className="text-lg font-semibold">
              ورود به سیستم
            </CardTitle>
            <CardDescription>
              برای ادامه، اطلاعات ورود خود را وارد کنید
            </CardDescription>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Error message */}
              {error && (
                <div className="animate-chat-fade-in rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm text-destructive">
                  {error}
                </div>
              )}

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  ایمیل
                </Label>
                <Input
                  id="email"
                  type="email"
                  dir="ltr"
                  placeholder="name@company.com"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={isLoading}
                  className="h-11 text-left"
                />
              </div>

              {/* Password */}
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium">
                  رمز عبور
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    dir="ltr"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    className="h-11 pe-10 text-left"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    tabIndex={-1}
                    disabled={isLoading}
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <Button
                type="submit"
                className="h-11 w-full gap-2 text-sm font-medium"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>در حال ورود…</span>
                  </>
                ) : (
                  <span>ورود</span>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="mt-4 text-center text-xs text-muted-foreground">
            دسترسی محدود و تحت نظارت سازمان
          </p>
      </div>
    </div>
  );
}
