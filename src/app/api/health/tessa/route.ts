import { NextResponse } from 'next/server';
import { getSession } from '@/lib/security/auth';
import { db } from '@/lib/db/client';
import { prelimAnalyses, documents } from '@/lib/db/schema';
import { sql, eq, gte, and } from 'drizzle-orm';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

const ADMIN_ROLES = ['super_admin', 'admin'];

interface Check {
  ok: boolean;
  detail: string;
  errors?: string[];
}

export async function GET() {
  const session = await getSession();
  if (!session || !ADMIN_ROLES.includes(session.role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const checks: Record<string, Check> = {};
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // 1. Schema check
  try {
    const [row] = await db.execute<{ count: string }>(
      sql`select count(*)::int as count from information_schema.columns where table_name = 'prelim_analyses'`,
    );
    const cols = Number((row as Record<string, unknown>)?.count ?? 0);
    checks.schema = { ok: cols > 0, detail: cols > 0 ? `prelim_analyses table has ${cols} columns` : 'prelim_analyses table not found' };
  } catch (err) {
    checks.schema = { ok: false, detail: `Schema check failed: ${err instanceof Error ? err.message : 'Unknown'}` };
  }

  // 2. Anthropic key
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  checks.anthropicKey = { ok: hasKey, detail: hasKey ? 'ANTHROPIC_API_KEY is set' : 'ANTHROPIC_API_KEY is NOT set' };

  // 3. S3 access
  try {
    const bucket = process.env.AWS_BUCKET;
    if (!bucket) {
      checks.s3Access = { ok: false, detail: 'AWS_BUCKET env var not set' };
    } else {
      const s3 = new S3Client({
        region: process.env.AWS_REGION ?? 'us-west-2',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
        },
      });
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
      checks.s3Access = { ok: true, detail: 'S3 bucket accessible' };
    }
  } catch (err) {
    checks.s3Access = { ok: false, detail: `S3 check failed: ${err instanceof Error ? err.message : 'Unknown'}` };
  }

  // 4 & 5. Recent successes and failures
  try {
    const [row] = await db
      .select({
        successCount: sql<number>`count(*) filter (where ${prelimAnalyses.status} = 'complete' and ${prelimAnalyses.createdAt} >= ${cutoff})::int`,
        failCount: sql<number>`count(*) filter (where ${prelimAnalyses.status} = 'failed' and ${prelimAnalyses.createdAt} >= ${cutoff})::int`,
      })
      .from(prelimAnalyses);

    const s = row!;
    checks.recentSuccess = {
      ok: s.successCount > 0,
      detail: s.successCount > 0
        ? `${s.successCount} successful analyses in last 24h`
        : 'No successful analysis in last 24h',
    };

    const failErrors: string[] = [];
    if (s.failCount > 0) {
      const errRows = await db
        .select({ msg: prelimAnalyses.errorMessage })
        .from(prelimAnalyses)
        .where(and(eq(prelimAnalyses.status, 'failed'), gte(prelimAnalyses.createdAt, cutoff)));
      for (const r of errRows) {
        if (r.msg && !failErrors.includes(r.msg)) failErrors.push(r.msg);
      }
    }
    checks.recentFailures = {
      ok: s.failCount === 0,
      detail: s.failCount === 0 ? 'No failures in last 24h' : `${s.failCount} failures in last 24h`,
      ...(failErrors.length > 0 && { errors: failErrors }),
    };
  } catch (err) {
    checks.recentSuccess = { ok: false, detail: `Query failed: ${err instanceof Error ? err.message : 'Unknown'}` };
    checks.recentFailures = { ok: false, detail: `Query failed: ${err instanceof Error ? err.message : 'Unknown'}` };
  }

  // 6. Pending prelims
  try {
    const [[prelimDocs], [analyzed]] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(documents).where(eq(documents.category, 'prelim')),
      db.select({ count: sql<number>`count(distinct ${prelimAnalyses.documentId})::int` }).from(prelimAnalyses),
    ]);
    checks.pendingPrelims = {
      ok: true,
      detail: `${prelimDocs!.count} prelim docs, ${analyzed!.count} analyzed`,
    };
  } catch (err) {
    checks.pendingPrelims = { ok: false, detail: `Query failed: ${err instanceof Error ? err.message : 'Unknown'}` };
  }

  // 7. pdf-parse library
  try {
    await import('pdf-parse/lib/pdf-parse');
    checks.pdfParseLibrary = { ok: true, detail: 'pdf-parse loads successfully' };
  } catch (err) {
    checks.pdfParseLibrary = { ok: false, detail: `pdf-parse failed to load: ${err instanceof Error ? err.message : 'Unknown'}` };
  }

  // Stats
  let stats: Record<string, unknown> = {};
  try {
    const [row] = await db
      .select({
        totalAnalyses: sql<number>`count(*)::int`,
        successful: sql<number>`count(*) filter (where ${prelimAnalyses.status} = 'complete')::int`,
        failed: sql<number>`count(*) filter (where ${prelimAnalyses.status} = 'failed')::int`,
        pending: sql<number>`count(*) filter (where ${prelimAnalyses.status} not in ('complete','failed'))::int`,
        avgProcessingMs: sql<number>`avg(extract(epoch from (${prelimAnalyses.completedAt} - ${prelimAnalyses.createdAt})) * 1000)::int`,
        lastSuccessAt: sql<string>`max(case when ${prelimAnalyses.status} = 'complete' then ${prelimAnalyses.completedAt} end)`,
        lastFailureAt: sql<string>`max(case when ${prelimAnalyses.status} = 'failed' then ${prelimAnalyses.updatedAt} end)`,
      })
      .from(prelimAnalyses);

    const s = row!;
    stats = {
      totalAnalyses: s.totalAnalyses,
      successful: s.successful,
      failed: s.failed,
      pending: s.pending,
      avgProcessingMs: s.avgProcessingMs ?? null,
      lastSuccessAt: s.lastSuccessAt ?? null,
      lastFailureAt: s.lastFailureAt ?? null,
    };
  } catch {
    stats = { error: 'Failed to load stats' };
  }

  // Status logic
  const critical = [checks.schema, checks.anthropicKey, checks.pdfParseLibrary];
  const allChecks = Object.values(checks);
  let status: 'healthy' | 'degraded' | 'broken';

  if (critical.some((c) => !c?.ok)) {
    status = 'broken';
  } else if (allChecks.every((c) => c.ok)) {
    status = 'healthy';
  } else {
    status = 'degraded';
  }

  return NextResponse.json({ status, checks, stats });
}
