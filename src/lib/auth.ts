import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { compare } from "bcryptjs";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthUser = {
  id: string;
  email: string;
  name: string | null;
  role: "ADMIN" | "EMPLOYEE";
  organizationId: string;
};

declare module "next-auth" {
  interface Session {
    user: AuthUser;
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface User extends AuthUser {}
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    email: string;
    name: string | null;
    role: "ADMIN" | "EMPLOYEE";
    organizationId: string;
  }
}

// ---------------------------------------------------------------------------
// Auth Options
// ---------------------------------------------------------------------------

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "ایمیل", type: "email" },
        password: { label: "رمز عبور", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const user = await db.user.findUnique({
          where: { email: credentials.email },
        });

        if (!user || !user.passwordHash) {
          return null;
        }

        const isValid = await compare(credentials.password, user.passwordHash);
        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as "ADMIN" | "EMPLOYEE",
          organizationId: user.organizationId,
        };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    // Long-lived session cookie/JWT — tolerant to client clock skew and
    // restrictive browser cookie policies (premature cookie expiry).
    maxAge: 365 * 24 * 60 * 60, // 1 year
  },
  jwt: {
    maxAge: 365 * 24 * 60 * 60, // 1 year — must match session.maxAge
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.name = user.name;
        token.role = user.role;
        token.organizationId = user.organizationId;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          id: token.id,
          email: token.email,
          name: token.name,
          role: token.role,
          organizationId: token.organizationId,
        };
      }
      return session;
    },
  },
  pages: {
    // We handle login client-side, but keep signOut as default
  },
  secret: process.env.NEXTAUTH_SECRET,
};

// ---------------------------------------------------------------------------
// Server-side helpers
// ---------------------------------------------------------------------------

import { getServerSession as _getServerSession } from "next-auth";
import {
  extractRequestToken,
  getCustomSessionUser,
  getSessionUserByToken,
} from "@/lib/custom-auth";
import type { Session } from "next-auth";

/**
 * Typed getServerSession with layered fallbacks:
 *  1) NextAuth JWT session cookie (preferred — keeps existing cookies working)
 *  2) Compact DB-backed session cookie — resilient to environments that drop
 *     large cookies (embedded previews, strict proxies).
 *  3) Cookieless bearer token (Authorization: Bearer / x-session-token) —
 *     for embedded preview frames where the browser blocks ALL cookies
 *     (third-party context), yet login still succeeded because the user
 *     object travels in the login response body.
 */
export async function getAuthSession(req?: Request) {
  // 1) NextAuth JWT session
  const nextAuthSession = await _getServerSession(authOptions);
  if (nextAuthSession?.user) return nextAuthSession;

  // 2) Compact DB-backed session cookie
  const customUser = await getCustomSessionUser();
  if (customUser) {
    return {
      user: customUser,
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    } satisfies Session;
  }

  // 3) Cookieless bearer token fallback
  if (req) {
    const token = extractRequestToken(req);
    if (token) {
      const tokenUser = await getSessionUserByToken(token);
      if (tokenUser) {
        return {
          user: tokenUser,
          expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        } satisfies Session;
      }
    }
  }

  return null;
}

/** Throw 401 if no session */
export async function requireAuth(req?: Request) {
  const session = await getAuthSession(req);
  if (!session?.user) {
    throw new Response(JSON.stringify({ error: "دسترسی غیرمجاز" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return session;
}

/** Throw 403 if not ADMIN */
export async function requireAdmin(req?: Request) {
  const session = await requireAuth(req);
  if (session.user.role !== "ADMIN") {
    throw new Response(
      JSON.stringify({ error: "فقط مدیران به این بخش دسترسی دارند" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
  return session;
}
