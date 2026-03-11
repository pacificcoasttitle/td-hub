'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, -apple-system, sans-serif', backgroundColor: '#F8F9FA' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div style={{ maxWidth: '400px', width: '100%', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #E5E7EB', padding: '32px', textAlign: 'center' }}>
            <div style={{ marginBottom: '16px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', height: '40px', width: '40px', borderRadius: '8px', backgroundColor: '#1B2A4A' }}>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>P</span>
              </div>
            </div>
            <h2 style={{ fontSize: '18px', fontWeight: 600, color: '#1A1A2E', margin: '0 0 4px' }}>
              Something went wrong
            </h2>
            <p style={{ fontSize: '14px', color: '#6B7280', margin: '0 0 24px' }}>
              {error.message || 'A critical error occurred. Please try again.'}
            </p>
            <button
              onClick={reset}
              style={{ padding: '10px 20px', fontSize: '14px', fontWeight: 500, backgroundColor: '#1B2A4A', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
