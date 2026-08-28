import { NextRequest } from 'next/server';
import { serveSoftProFetchDoc } from '../../../handler';

/** Legacy HMAC URL without a filename segment. Still downloads; new posts append a name. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ documentId: string; exp: string; sig: string }> },
) {
  const { documentId, exp, sig } = await params;
  return serveSoftProFetchDoc(documentId, exp, sig);
}
