import { NextRequest, NextResponse } from "next/server";
import { compare } from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  createUserSession,
  purgeExpiredSessions,
  SESSION_COOKIE,
} from "@/lib/custom-auth";

/**
 * Compact login endpoint.
 *
 * Validates credentials and issues a tiny opaque session cookie backed by the
 * UserSession table. The user object is returned in the response body, so the
 * client never depends on a cookie read-back to know who is logged in.
 */

const loginSchema = z.object({
  email: z.string().email("ایمیل نامعتبر است"),
  password: z.string().min(1, "رمز عبور الزامی است"),
});

// ─── Simple in-memory rate limiter: 5 attempts / 5 minutes / IP ─────────────
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

/**
 * Create a NextAuth credentials session from a Route Handler by performing
 * the internal csrf + callback dance against our own origin, then returning
 * the Set-Cookie headers to relay to the client.
 * Used as a fallback when the compact session table is unavailable.
 */
async function createNextAuthSession(
  req: NextRequest,
  email: string,
  password: string
): Promise<string[]> {
  try {
    const origin = req.nextUrl.origin;

    const csrfRes = await fetch(`${origin}/api/auth/csrf`, {
      cache: "no-store",
    });
    if (!csrfRes.ok) return [];

    const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
    if (!csrfToken) return [];

    const csrfCookies = (csrfRes.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(";")[0])
      .join("; ");

    const callbackRes = await fetch(
      `${origin}/api/auth/callback/credentials`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(csrfCookies ? { Cookie: csrfCookies } : {}),
        },
        body: new URLSearchParams({ csrfToken, email, password }),
        redirect: "manual",
      }
    );

    if (callbackRes.status !== 200 && callbackRes.status !== 302) {
      return [];
    }

    return callbackRes.headers.getSetCookie?.() ?? [];
  } catch (err) {
    console.warn("[custom-login] NextAuth fallback session failed:", err);
    return [];
  }
}

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "unknown";

    if (rateLimited(ip)) {
      return NextResponse.json(
        { error: "تلاش‌های زیادی انجام شده است. چند دقیقه بعد دوباره امتحان کنید." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "لطفاً ایمیل و رمز عبور معتبر وارد کنید" },
        { status: 400 }
      );
    }
    const { email, password } = parsed.data;

    const user = await db.user.findUnique({ where: { email } });
    if (!user) {
      return NextResponse.json(
        { error: "ایمیل یا رمز عبور اشتباه است" },
        { status: 401 }
      );
    }

    const isValid = await compare(password, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { error: "ایمیل یا رمز عبور اشتباه است" },
        { status: 401 }
      );
    }

    // Issue compact DB-backed session cookie. If the UserSession table is
    // missing (stale Prisma client / DB that hasn't run `prisma db push`),
    // degrade gracefully: fall back to a NextAuth credentials session so
    // login still works end-to-end in normal browsers.
    let token: string | null = null;
    try {
      token = await createUserSession(user.id);
      void purgeExpiredSessions().catch(() => {});
    } catch (sessionErr) {
      console.warn(
        "[custom-login] Compact session unavailable (UserSession table missing?)",
        "→ fix on your machine: `npx prisma db push` then restart the dev server.",
        "\nFalling back to NextAuth session.",
        sessionErr
      );
    }

    const res = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        organizationId: user.organizationId,
      },
      // Cookieless fallback: embedded preview frames / strict browsers may
      // block ALL cookies — the client keeps this token and sends it as
      // `Authorization: Bearer <token>` instead.
      sessionToken: token,
    });

    if (token) {
      res.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });
    } else {
      // Establish a NextAuth credentials session server-side and relay its
      // cookies, so the user stays logged in across reloads even without the
      // compact session table.
      const authCookies = await createNextAuthSession(req, email, password);
      for (const c of authCookies) {
        res.headers.append("set-cookie", c);
      }
    }

    return res;
  } catch (err) {
    console.error("[custom-login] error:", err);
    return NextResponse.json(
      { error: "خطا در برقراری ارتباط با سرور" },
      { status: 500 }
    );
  }
}
