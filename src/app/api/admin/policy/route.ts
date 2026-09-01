import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { getPolicyDocuments, createPolicyDocument } from '@/lib/db';
import { processPolicyDocument } from '@/lib/policy/pdf-processor';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'policy-docs');
const POLICY_MAX_UPLOAD_SIZE =
  parseInt(process.env.POLICY_MAX_UPLOAD_SIZE ?? '10485760', 10); // 10MB

// GET /api/admin/policy — list policy documents
export async function GET(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const docs = await getPolicyDocuments(session.user.organizationId);

    const result = docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      size: d.size,
      status: d.status,
      version: d.version,
      isActive: d.isActive,
      extractedCharCount: d.extractedCharCount,
      errorMessage: d.errorMessage,
      createdAt: d.createdAt,
    }));

    return Response.json(result);
  } catch (err) {
    if (err instanceof Response) return err;
    return Response.json({ error: 'خطا در دریافت اسناد' }, { status: 500 });
  }
}

// POST /api/admin/policy — upload a policy document
export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin(request);
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return Response.json({ error: 'فایل ارسال نشده است' }, { status: 400 });
    }

    // Validate MIME type
    if (file.type !== 'application/pdf') {
      return Response.json(
        { error: 'فقط فایل‌های PDF مجاز هستند' },
        { status: 400 },
      );
    }

    // Validate file size
    if (file.size > POLICY_MAX_UPLOAD_SIZE) {
      return Response.json(
        { error: `حجم فایل نباید بیشتر از ${Math.round(POLICY_MAX_UPLOAD_SIZE / 1024 / 1024)} مگابایت باشد` },
        { status: 400 },
      );
    }

    // Read file buffer and check magic bytes
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.slice(0, 4).toString('ascii') !== '%PDF') {
      return Response.json(
        { error: 'فایل PDF نامعتبر است' },
        { status: 400 },
      );
    }

    // Sanitize filename
    const sanitized = path.basename(file.name).replace(/[^a-zA-Z0-9._\-\u0600-\u06FF]/g, '_');

    // Generate document ID and save file
    const documentId = crypto.randomUUID();
    const storagePath = path.join(UPLOADS_DIR, `${documentId}.pdf`);

    // Ensure the uploads directory exists (fresh clones / new machines don't
    // have it — writeFileSync would otherwise throw ENOENT).
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });

    fs.writeFileSync(storagePath, buffer);

    // Create DB record — pass the SAME id used for the stored file, so
    // processPolicyDocument (which looks for `${doc.id}.pdf`) finds it.
    const doc = await createPolicyDocument({
      id: documentId,
      organizationId: session.user.organizationId,
      filename: sanitized,
      mimeType: 'application/pdf',
      size: file.size,
      storagePath,
      uploadedById: session.user.id,
    });

    // Fire-and-forget processing
    processPolicyDocument(doc.id, session.user.organizationId).catch(() => {
      // Errors handled inside processPolicyDocument
    });

    return Response.json({
      id: doc.id,
      filename: doc.filename,
      size: doc.size,
      status: doc.status,
      version: doc.version,
      isActive: doc.isActive,
      createdAt: doc.createdAt,
    }, { status: 201 });
  } catch (err) {
    if (err instanceof Response) return err;
    console.error('[policy-upload] error:', err);
    const detail = err instanceof Error ? err.message : undefined;
    return Response.json(
      {
        error: detail
          ? `خطا در آپلود سند (${detail})`
          : 'خطا در آپلود سند',
      },
      { status: 500 },
    );
  }
}
