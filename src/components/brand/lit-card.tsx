import type { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

type LitCardProps<T extends ElementType = 'div'> = {
  as?: T;
  children: ReactNode;
  className?: string;
  /**
   * Override the warm glow with a CSS background-image.
   *
   * Added for the party wizard header, which has to be comparable to the email
   * hero by eye — a recipient who suspects phishing scrolls back up to the
   * email and looks. The base surface gradient was already identical; this lets
   * the glow be identical too. Everything else keeps the default.
   */
  glow?: string;
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'children' | 'className'>;

/**
 * Coastline "lit" surface — login sky gradient + email orange hairline +
 * off-canvas warm glow. Used for sales KPI cards (Variant C).
 */
export function LitCard<T extends ElementType = 'div'>({
  as,
  children,
  className = '',
  glow,
  ...props
}: LitCardProps<T>) {
  const Comp = as ?? 'div';

  return (
    <Comp
      className={`relative overflow-hidden rounded-[18px] border border-white/10
        bg-[linear-gradient(180deg,#2C3564_0%,#15193A_100%)]
        shadow-[0_22px_55px_-26px_rgba(16,33,58,0.55)]
        print:bg-white print:text-[#10213A] print:shadow-none
        ${className}`}
      {...props}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[2px]
          bg-gradient-to-r from-[#F26B2B] to-transparent print:hidden"
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 print:hidden ${
          glow ? '' : 'bg-[radial-gradient(120%_90%_at_82%_8%,rgba(242,107,43,0.30),transparent_55%)]'
        }`}
        style={glow ? { backgroundImage: glow } : undefined}
      />
      <div className="relative px-6 py-[22px]">{children}</div>
    </Comp>
  );
}
