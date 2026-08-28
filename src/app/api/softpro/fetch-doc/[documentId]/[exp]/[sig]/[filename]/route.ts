import { NextRequest } from 'next/server';
import { serveSoftProFetchDoc } from '../../../../handler';

/**
 * Preferred SoftPro FileURL shape: last path segment is a legal filename.
 * Path.GetFileName on the Windows host uses that segment as the stored name.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ documentId: string; exp: string; sig: string; filename: string }> },
) {
  const { documentId, exp, sig } = await params;
  return serveSoftProFetchDoc(documentId, exp, sig);
}
