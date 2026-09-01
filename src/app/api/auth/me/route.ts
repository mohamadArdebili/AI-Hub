import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

/**
 * Unified "who am I" endpoint.
 * Checks NextAuth session, then the compact DB-backed session cookie, then
 * the Authorization bearer token (cookieless clients).
 * Returns {} when unauthenticated (200, never errors).
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getAuthSession(req);
    if (session?.user) {
      return NextResponse.json({ user: session.user });
    }
    return NextResponse.json({});
  } catch {
    return NextResponse.json({});
  }
}
