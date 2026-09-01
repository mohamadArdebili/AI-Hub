import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { updatePolicyRule, deletePolicyRule } from '@/lib/db';
import type { RuleSeverity } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SEVERITIES: RuleSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// PATCH /api/admin/rules/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;
    const body = await request.json();

    const updateData: Record<string, unknown> = {};

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        return Response.json({ error: 'عنوان نامعتبر است' }, { status: 400 });
      }
      updateData.title = body.title.trim();
    }

    if (body.body !== undefined) {
      updateData.body = typeof body.body === 'string' ? body.body : null;
    }

    if (body.keywords !== undefined) {
      if (!Array.isArray(body.keywords)) {
        return Response.json({ error: 'کلیدواژه‌ها باید آرایه باشند' }, { status: 400 });
      }
      updateData.keywords = body.keywords as string[];
    }

    if (body.patterns !== undefined) {
      if (!Array.isArray(body.patterns)) {
        return Response.json({ error: 'الگوها باید آرایه باشند' }, { status: 400 });
      }
      updateData.patterns = body.patterns as string[];
    }

    if (body.severity !== undefined) {
      if (!VALID_SEVERITIES.includes(body.severity)) {
        return Response.json(
          { error: 'سطح شدت نامعتبر است' },
          { status: 400 },
        );
      }
      updateData.severity = body.severity as RuleSeverity;
    }

    if (body.category !== undefined) {
      updateData.category = typeof body.category === 'string' ? body.category : null;
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== 'boolean') {
        return Response.json({ error: 'مقدار isActive باید بولی باشد' }, { status: 400 });
      }
      updateData.isActive = body.isActive;
    }

    if (Object.keys(updateData).length === 0) {
      return Response.json({ error: 'حداقل یک فیلد باید ارسال شود' }, { status: 400 });
    }

    const updated = await updatePolicyRule(id, updateData);

    return Response.json({
      id: updated.id,
      code: updated.code,
      title: updated.title,
      body: updated.body,
      keywords: safeParseJsonArray(updated.keywords),
      patterns: safeParseJsonArray(updated.patterns),
      severity: updated.severity,
      category: updated.category,
      isActive: updated.isActive,
      isManual: updated.isManual,
      createdAt: updated.createdAt,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    if (err instanceof Error && err.message.includes('not found')) {
      return Response.json({ error: 'قاعده یافت نشد' }, { status: 404 });
    }
    return Response.json({ error: 'خطا در بروزرسانی قاعده' }, { status: 500 });
  }
}

// DELETE /api/admin/rules/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireAdmin(request);
    const { id } = await params;

    await deletePolicyRule(id, session.user.organizationId);

    return Response.json({ success: true });
  } catch (err) {
    if (err instanceof Response) return err;
    if (err instanceof Error && err.message.includes('not found')) {
      return Response.json({ error: 'قاعده یافت نشد' }, { status: 404 });
    }
    return Response.json({ error: 'خطا در حذف قاعده' }, { status: 500 });
  }
}

function safeParseJsonArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
