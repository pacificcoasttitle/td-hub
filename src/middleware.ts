import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = [
  '/login',
  '/api/health',
];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  // SoftPro webhooks stay session-public; handlers verify SOFTPRO_WEBHOOK_SECRET.
  if (pathname.startsWith('/api/webhooks/softpro/')) return true;
  // SendGrid's event webhook. A provider POSTs here with no session and no
  // cookie, so the middleware must let it through; the handler verifies an
  // ECDSA signature over the raw body and refuses anything it cannot check.
  //
  // THIS LINE IS THE WHOLE WEBHOOK. Without it the middleware answers 401 with
  // `{"error":"Unauthorized"}` — BYTE-IDENTICAL to the handler's own refusal —
  // so the endpoint looks correctly locked down from outside while never
  // running at all. It shipped that way on 2026-09-22 and received nothing.
  if (pathname.startsWith('/api/webhooks/sendgrid/')) return true;
  // SoftPro AddDocuments downloads FileURL; HMAC verified in the route handler.
  if (pathname.startsWith('/api/softpro/fetch-doc/')) return true;
  // Party wizard links go to external parties with no TD Hub login; the HMAC
  // token in the path is the credential and is verified in the handler.
  if (pathname.startsWith('/party-wizard/')) return true;
  if (pathname.startsWith('/api/party-wizard/')) return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.startsWith('/favicon')) return true;
  return false;
}

/**
 * Exposed for src/middleware.test.ts, which asserts that every webhook route
 * in the tree is reachable without a session. Re-implementing these rules in
 * the test would let the copy agree with itself while the site disagreed.
 */
export const isPublicForTest = isPublic;

function isJobRoute(pathname: string): boolean {
  return pathname.startsWith('/api/jobs/');
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function isProtectedPage(pathname: string): boolean {
  return pathname.startsWith('/admin') || pathname.startsWith('/client') || pathname.startsWith('/sales');
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  // Job routes: check JOB_RUNNER_SECRET or CRON_SECRET Bearer token
  if (isJobRoute(pathname)) {
    const authHeader = req.headers.get('authorization');

    const jobSecret = process.env.JOB_RUNNER_SECRET;
    if (jobSecret && authHeader === `Bearer ${jobSecret}`) {
      return NextResponse.next();
    }

    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      return NextResponse.next();
    }

    // Fall through to Supabase session check — admins can also access job routes
  }

  // Create Supabase client for Edge middleware
  const res = NextResponse.next();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            req.cookies.set(name, value);
            res.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isProtectedPage(pathname)) {
      const loginUrl = new URL('/login', req.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return res;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
