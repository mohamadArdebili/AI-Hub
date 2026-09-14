import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getPolicyLlm } from '@/lib/policy/local-llm-adapter';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/admin/policy/llm-status — Local-LLM availability for the admin UI.
// NEVER throws and NEVER performs a network call when the layer is disabled
// (NoopPolicyLlm answers DISABLED_BY_ENV synchronously from the env contract).
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const llm = getPolicyLlm();
    const availability = await llm.availability();

    return Response.json({
      enabled: process.env.POLICY_LOCAL_LLM_ENABLED === 'true',
      ...availability,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[llm-status] error:', err);
    return Response.json(
      { enabled: false, available: false, reason: 'UNKNOWN' },
      { status: 200 }, // status endpoint must never fail the UI
    );
  }
}
