import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { canAccessOrder } from '@/lib/security/client-scope';
import { uploadDocument } from '@/lib/domain/documents/service';

const ALLOWED_CATEGORIES = ['general', 'user_upload', 'curative'] as const;
type ClientCategory = (typeof ALLOWED_CATEGORIES)[number];

function isAllowedCategory(c: string): c is ClientCategory {
  return (ALLOWED_CATEGORIES as readonly string[]).includes(c);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id: rawId } = await params;
    const orderId = Number(rawId);
    if (Number.isNaN(orderId) || orderId <= 0) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    const allowed = await canAccessOrder(session.id, orderId);
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const category = (formData.get('category') as string) ?? 'user_upload';
    const description = (formData.get('description') as string) ?? '';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!isAllowedCategory(category)) {
      return NextResponse.json(
        { error: `Category "${category}" not allowed. Use: ${ALLOWED_CATEGORIES.join(', ')}` },
        { status: 403 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = `client_${Date.now()}_${file.name}`;

    const result = await uploadDocument({
      orderId,
      file: buffer,
      filename,
      contentType: file.type || 'application/octet-stream',
      category,
      description: description || `Client upload: ${file.name}`,
      userId: session.id,
    });

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      storageKey: result.storageKey,
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 },
    );
  }
}
