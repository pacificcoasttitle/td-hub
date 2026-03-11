import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { uploadDocument } from '@/lib/domain/documents/service';
import { docCategoryEnum } from '@/lib/db/schema/documents';

const ALLOWED_CATEGORIES = docCategoryEnum.enumValues;

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const orderIdRaw = formData.get('orderId') as string | null;
    const category = (formData.get('category') as string) || 'general';
    const description = (formData.get('description') as string) || undefined;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const orderId = parseInt(orderIdRaw ?? '', 10);
    if (isNaN(orderId)) {
      return NextResponse.json({ error: 'Invalid order ID' }, { status: 400 });
    }

    if (!(ALLOWED_CATEGORIES as readonly string[]).includes(category)) {
      return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await uploadDocument({
      orderId,
      file: buffer,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      category: category as (typeof ALLOWED_CATEGORIES)[number],
      description,
      userId: session.id,
    });

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      storageKey: result.storageKey,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
