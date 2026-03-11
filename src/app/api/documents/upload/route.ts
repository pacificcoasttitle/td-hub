import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/security/auth';
import { uploadDocument } from '@/lib/domain/documents/service';
import { docCategoryEnum } from '@/lib/db/schema/documents';

const fieldSchema = z.object({
  orderId: z.coerce.number().int().positive(),
  category: z.enum(docCategoryEnum.enumValues).default('general'),
  description: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await req.formData();

    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const fields = fieldSchema.parse({
      orderId: formData.get('orderId'),
      category: formData.get('category') || undefined,
      description: formData.get('description') || undefined,
    });

    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await uploadDocument({
      orderId: fields.orderId,
      file: buffer,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      category: fields.category,
      description: fields.description,
      userId: session.id,
    });

    return NextResponse.json({
      success: true,
      documentId: result.documentId,
      storageKey: result.storageKey,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid parameters', details: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : 'Upload failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
