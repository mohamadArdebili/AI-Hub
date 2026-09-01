"use client";

import { useAuthStore } from "@/stores/auth-store";

/**
 * fetch wrapper that attaches the compact session token as an
 * `Authorization: Bearer <token>` header.
 *
 * Why: embedded preview frames and strict browser privacy settings can block
 * ALL cookies in third-party contexts. Login still works (the user object is
 * returned in the response body), but cookie-based auth silently breaks for
 * every subsequent request. The token survives in localStorage and travels
 * via this header instead, so authed API calls work in every environment.
 *
 * Cookie-based auth continues to work unchanged — the header is additive.
 */
export async function authFetch(
  input: string,
  init: RequestInit = {}
): Promise<Response> {
  const token = useAuthStore.getState().sessionToken;

  const headers = new Headers(init.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers });
}
