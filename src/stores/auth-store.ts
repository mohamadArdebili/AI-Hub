import { create } from "zustand";
import type { Session } from "next-auth";

import { authFetch } from "@/lib/api-client";

type ViewType = "login" | "chat" | "admin";

interface AuthState {
  session: Session | null;
  /** Opaque compact-session token (cookieless fallback for blocked-cookie environments). */
  sessionToken: string | null;
  isLoading: boolean;
  currentView: ViewType;

  // Actions
  setSession: (session: Session | null) => void;
  loginSuccess: (user: Session["user"], token: string | null) => void;
  setLoading: (loading: boolean) => void;
  setView: (view: ViewType) => void;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

// ─── localStorage persistence for the session token ─────────────────────────
// localStorage remains writable/readable inside cross-origin iframes even
// when the browser blocks third-party cookies entirely.
const TOKEN_STORAGE_KEY = "dsg_session_token";

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private mode etc.) — cookie path still works.
  }
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  sessionToken: readStoredToken(),
  isLoading: true,
  currentView: "login",

  setSession: (session) => {
    const prevView = get().currentView;
    const nextView: ViewType = session ? (prevView === "login" ? "chat" : prevView) : "login";
    if (!session) storeToken(null);
    set({ session, currentView: nextView });
  },

  loginSuccess: (user, token) => {
    storeToken(token);
    set({
      session: {
        user,
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      sessionToken: token,
      currentView: "chat",
    });
  },

  setLoading: (isLoading) => set({ isLoading }),

  setView: (currentView) => set({ currentView }),

  logout: async () => {
    try {
      // Compact DB-backed session logout (clears cookie/token + DB row)
      await authFetch("/api/auth/logout-session", { method: "POST" });
    } catch {
      // continue with local cleanup regardless
    }
    try {
      const csrfRes = await fetch("/api/auth/csrf");
      if (csrfRes.ok) {
        const { csrfToken } = await csrfRes.json();
        await fetch("/api/auth/signout", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ csrfToken }),
        });
      }
    } catch {
      // Even if signOut fails, clear local state
    }
    storeToken(null);
    set({ session: null, sessionToken: null, currentView: "login" });
  },

  refreshSession: async () => {
    try {
      const res = await authFetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data?.user) {
          const prevView = get().currentView;
          set({
            session: { user: data.user, expires: data.expires ?? "" },
            currentView: prevView === "login" ? "chat" : prevView,
          });
        }
      }
    } catch {
      // Silently fail
    }
  },

  initialize: async () => {
    set({ isLoading: true });
    try {
      // /api/auth/me unifies all session mechanisms (NextAuth JWT + compact
      // DB-backed cookie + bearer-token header) and returns {} when
      // unauthenticated.
      let user: Session["user"] | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await authFetch("/api/auth/me", { cache: "no-store" });
          if (res.ok) {
            const data = await res.json();
            if (data?.user) {
              user = data.user;
              break;
            }
          }
        } catch {
          // transient error — retry once
        }
        if (attempt < 1) await new Promise((r) => setTimeout(r, 250));
      }

      const isAuthenticated = !!user;
      if (!isAuthenticated) storeToken(null);
      set({
        session: isAuthenticated ? { user: user!, expires: "" } : null,
        sessionToken: isAuthenticated ? get().sessionToken : null,
        currentView: isAuthenticated ? "chat" : "login",
      });
    } catch {
      set({ session: null, currentView: "login" });
    } finally {
      set({ isLoading: false });
    }
  },
}));
