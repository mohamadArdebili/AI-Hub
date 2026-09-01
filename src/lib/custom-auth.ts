import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth";

/**
 * Compact, DB-backed browser sessions.
 *
 * Why: some browser/proxy environments (embedded preview frames, strict cookie
 * policies) drop or truncate large cookies. NextAuth's default session cookie
 * is a ~600-char encrypted JWT, which such environments may discard — while a
 * small cookie (like NextAuth's ~160-char CSRF cookie) survives just fine.
 *
 * This module stores an opaque 48-char token in a tiny cookie and keeps the
 * session server-side (SHA-256 hashed) in the UserSession table.
 */

export const SESSION_COOKIE = "dsg_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOKEN_RE = /^[a-f0-9]{48}$/;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time string comparison to avoid token-comparison side channels. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Create a DB session for the user and return the opaque cookie token. */
export async function createUserSession(userId: string): Promise<string> {
  const token = randomBytes(24).toString("hex"); // 48 chars
  await db.userSession.create({
    data: {
      id: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return token;
}

/**
 * Resolve the current user from an explicit opaque session token.
 * Used by both the cookie path and the cookieless header fallback.
 */
export async function getSessionUserByToken(
  token: string | null | undefined
): Promise<AuthUser | null> {
  try {
    if (!token || !TOKEN_RE.test(token)) return null;

    const session = await db.userSession.findUnique({
      where: { id: hashToken(token) },
      include: { user: true },
    });
    if (!session) return null;
    if (!safeEqual(session.id, hashToken(token))) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      // Expired — clean up lazily.
      await db.userSession.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }

    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role as AuthUser["role"],
      organizationId: session.user.organizationId,
    };
  } catch {
    return null;
  }
}

/**
 * Extract the opaque session token from an incoming request without relying
 * on cookies: `Authorization: Bearer <token>` or `x-session-token`.
 * This powers environments where cookies are unavailable entirely (embedded
 * preview frames with third-party cookies blocked, strict privacy modes).
 */
export function extractRequestToken(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (TOKEN_RE.test(token)) return token;
  }

  const altHeader = req.headers.get("x-session-token");
  if (altHeader) {
    const token = altHeader.trim();
    if (TOKEN_RE.test(token)) return token;
  }

  return null;
}

/** Resolve the current user from the compact session cookie (or null). */
export async function getCustomSessionUser(): Promise<AuthUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    return await getSessionUserByToken(token);
  } catch {
    return null;
  }
}

/** Destroy the current session (logout). */
export async function destroyCustomSession(req?: Request): Promise<void> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (token) {
      await db.userSession
        .delete({ where: { id: hashToken(token) } })
        .catch(() => {});
    }
    cookieStore.delete(SESSION_COOKIE);
  } catch {
    // ignore
  }

  // Cookieless clients logout via the Authorization header token.
  if (req) {
    const headerToken = extractRequestToken(req);
    if (headerToken) {
      await db.userSession
        .delete({ where: { id: hashToken(headerToken) } })
        .catch(() => {});
    }
  }
}

/** Remove expired sessions (housekeeping). */
export async function purgeExpiredSessions(): Promise<void> {
  await db.userSession
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});
}
