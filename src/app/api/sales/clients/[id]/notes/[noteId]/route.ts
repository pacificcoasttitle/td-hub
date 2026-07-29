import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { CrmAccessError, deleteNote } from '@/lib/domain/crm/clients';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; noteId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: rawId, noteId: rawNoteId } = await params;
  const id = Number(rawId);
  const noteId = Number(rawNoteId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(noteId) || noteId <= 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    await deleteNote(session, id, noteId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof CrmAccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: 'Internal server error', ...(process.env.NODE_ENV === 'development' && { detail: err instanceof Error ? err.message : 'Unknown' }) },
      { status: 500 },
    );
  }
}
