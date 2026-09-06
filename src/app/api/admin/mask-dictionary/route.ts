import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import {
  getMaskDictionaries,
  createMaskDictionary,
  isUniqueConstraintViolation,
} from '@/lib/db';
import type { MaskKind } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_KINDS: MaskKind[] = [
  'SENIOR_OFFICER',
  'TELCO_HUB_NODE',
  'PROPRIETARY_SERVICE',
];

// GET /api/admin/mask-dictionary — list all dictionary entries
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const entries = await getMaskDictionaries(session.user.organizationId);
    return Response.json(
      entries.map((e) => ({
        id: e.id,
        kind: e.kind,
        term: e.term,
        isActive: e.isActive,
        createdAt: e.createdAt,
      })),
    );
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: 'خطا در دریافت دیکشنری ماسک‌گذاری' }, { status: 500 });
  }
}

// POST /api/admin/mask-dictionary — add a term
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const body = await request.json();
    const { kind, term } = body;

    if (!kind || !VALID_KINDS.includes(kind)) {
      return Response.json(
        { error: 'نوع دیکشنری باید یکی از SENIOR_OFFICER, TELCO_HUB_NODE, PROPRIETARY_SERVICE باشد' },
        { status: 400 },
      );
    }
    if (!term || typeof term !== 'string' || term.trim().length < 2 || term.length > 120) {
      return Response.json(
        { error: 'عبارت باید بین ۲ تا ۱۲۰ کاراکتر باشد' },
        { status: 400 },
      );
    }

    const entry = await createMaskDictionary({
      organizationId: session.user.organizationId,
      kind: kind as MaskKind,
      term: term.trim(),
    });

    return Response.json(
      {
        id: entry.id,
        kind: entry.kind,
        term: entry.term,
        isActive: entry.isActive,
        createdAt: entry.createdAt,
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Response) return err;
    if (isUniqueConstraintViolation(err)) {
      return Response.json(
        { error: 'این عبارت قبلاً در همین دیکشنری ثبت شده است' },
        { status: 409 },
      );
    }
    return Response.json({ error: 'خطا در افزودن عبارت' }, { status: 500 });
  }
}
