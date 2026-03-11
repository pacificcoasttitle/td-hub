'use client';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <div className="max-w-lg w-full bg-white rounded-lg border border-gray-200 shadow-sm p-8">
        <div className="flex items-start gap-4">
          <div className="shrink-0 h-10 w-10 rounded-full bg-[#1B2A4A] flex items-center justify-center">
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-[#1A1A2E]">Something went wrong</h2>
            <p className="text-sm text-[#6B7280] mt-1 break-words">
              {error.message || 'An unexpected error occurred while loading this page.'}
            </p>
            {error.digest && (
              <p className="text-xs text-[#9CA3AF] mt-2 font-mono">Error ID: {error.digest}</p>
            )}
            <button
              onClick={reset}
              className="mt-5 px-5 py-2 text-sm font-medium bg-[#1B2A4A] text-white rounded-lg hover:bg-[#243658] transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
