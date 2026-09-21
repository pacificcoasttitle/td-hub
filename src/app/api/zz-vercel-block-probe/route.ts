// THROWAWAY — never merged. Proves a failing Vercel build blocks a merge.
// An invalid route segment config: plain TypeScript to tsc, invisible to the
// test suite, rejected by `next build`. See the PR that carries it.
import { NextResponse } from 'next/server';

export const dynamic = 'not-a-real-mode';

export async function GET() {
  return NextResponse.json({ ok: true });
}
