import { NextRequest, NextResponse } from "next/server";
import { destroyCustomSession } from "@/lib/custom-auth";

/**
 * Logout for the compact DB-backed session (clears cookie + deletes DB row).
 * Cookieless clients pass the token via Authorization header, which is also
 * revoked here.
 * The NextAuth session (if any) is signed out client-side via /api/auth/signout.
 */
export async function POST(req: NextRequest) {
  await destroyCustomSession(req);
  return NextResponse.json({ ok: true });
}
