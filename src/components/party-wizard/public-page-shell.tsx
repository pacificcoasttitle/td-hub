import Image from 'next/image';

// ─── The public shell ────────────────────────────────────────────────────────
//
// Background and container match the sales dashboard shell
// (src/app/(sales)/layout.tsx:30 — bg-[#F5F6FA], p-6), narrowed to a reading
// column because this is one form and not a workspace.
//
// The logo is the real asset rather than the orange uppercase wordmark this
// page used to draw for itself. A stranger who has been forwarded a link checks
// whether the page looks like the email; a text approximation of a logo is the
// thing that fails that check.
//
// It is the DARK-ink variant, not the /logo2.png the login page uses. Those are
// two renderings of the same mark for two backgrounds — logo2-light is white
// ink for the navy login screen and the email hero, logo2-dark is for a light
// surface. This shell is #F5F6FA, so logo2.png rendered as white-on-near-white
// and was invisible on screen. Same pairing as email-layout.ts:24-25.

export function PublicPageShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#F5F6FA] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="mb-6 flex justify-center">
          <Image
            src="/logo2-dark.png"
            alt="Pacific Coast Title"
            width={200}
            height={40}
            className="h-9 w-auto sm:h-10"
            priority
          />
        </div>

        {children}

        <p className="mt-8 text-center text-xs leading-relaxed text-[#6B7280]">
          Pacific Coast Title Company
          <span className="mx-1.5 text-[#6B7280]/50">·</span>
          <a
            href="https://www.pct.com"
            className="font-medium text-[#C2551A] transition-colors hover:text-[#A34716]"
          >
            pct.com
          </a>
        </p>
      </div>
    </main>
  );
}
