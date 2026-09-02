import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getPolicyRules,
  createPolicyRule,
  isUniqueConstraintViolation,
} from '@/lib/db';
import type { RuleSeverity } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_SEVERITIES: RuleSeverity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

// GET /api/admin/rules — list all rules for organization
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const rules = await getPolicyRules(session.user.organizationId);

    const result = rules.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      code: r.code,
      title: r.title,
      body: r.body,
      keywords: safeParseJsonArray(r.keywords),
      patterns: safeParseJsonArray(r.patterns),
      severity: r.severity,
      category: r.category,
      isActive: r.isActive,
      isManual: r.isManual,
      createdAt: r.createdAt,
    }));

    return Response.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: 'خطا در دریافت قواعد' }, { status: 500 });
  }
}

// POST /api/admin/rules — create a manual rule
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const body = await request.json();

    const { code, title, keywords, severity } = body;

    if (!code || typeof code !== 'string' || code.trim().length === 0) {
      return Response.json({ error: 'کد قاعده الزامی است' }, { status: 400 });
    }
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return Response.json({ error: 'عنوان قاعده الزامی است' }, { status: 400 });
    }
    if (!Array.isArray(keywords) || keywords.length === 0) {
      return Response.json({ error: 'حداقل یک کلیدواژه الزامی است' }, { status: 400 });
    }
    if (!VALID_SEVERITIES.includes(severity)) {
      return Response.json(
        { error: 'سطح شدت باید یکی از LOW, MEDIUM, HIGH, CRITICAL باشد' },
        { status: 400 },
      );
    }

    const rule = await createPolicyRule({
      organizationId: session.user.organizationId,
      code: code.trim(),
      title: title.trim(),
      body: body.body ?? undefined,
      keywords: keywords as string[],
      patterns: Array.isArray(body.patterns) ? (body.patterns as string[]) : [],
      severity: severity as RuleSeverity,
      category: body.category ?? undefined,
      isManual: true,
    });

    return Response.json({
      id: rule.id,
      code: rule.code,
      title: rule.title,
      body: rule.body,
      keywords: safeParseJsonArray(rule.keywords),
      patterns: safeParseJsonArray(rule.patterns),
      severity: rule.severity,
      category: rule.category,
      isActive: rule.isActive,
      isManual: rule.isManual,
      createdAt: rule.createdAt,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof Response) return err;
    if (isUniqueConstraintViolation(err)) {
      return Response.json(
        { error: 'کد قاعده تکراری است؛ برای این سازمان قاعده‌ای با همین کد وجود دارد. لطفاً کد دیگری انتخاب کنید' },
        { status: 409 },
      );
    }
    return Response.json({ error: 'خطا در ایجاد قاعده' }, { status: 500 });
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
