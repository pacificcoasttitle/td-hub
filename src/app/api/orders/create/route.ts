import { NextRequest, NextResponse } from 'next/server';
import { createAndSendToSoftPro } from '@/lib/domain/orders/create-order';

export async function POST(req: NextRequest) {
  try {
    const body: unknown = await req.json();
    const result = await createAndSendToSoftPro(body);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      orderId: result.orderId,
      fileNumber: result.fileNumber,
    }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Order creation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
