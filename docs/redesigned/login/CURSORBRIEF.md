# TD Hub — Login redesign ("Coastline")

Paste this whole file into Cursor as context, along with `login-page.tsx`.

---

## What I detected from the live site

| | |
|---|---|
| Framework | Next.js **App Router** (RSC payload present, no `__NEXT_DATA__`), Turbopack |
| Styling | Tailwind, using arbitrary hex values (`bg-[#F26B2B]`, `focus:ring-[#F26B2B]/30`) |
| Route | `/login` → almost certainly `app/login/page.tsx` |
| Current form | `id="email"` / `id="password"`, `autoComplete` set, password visibility toggle, `space-y-5` |
| Host | Vercel |

The new component keeps every one of those form semantics. Only markup and classes change.

---

## The task

Replace the contents of `app/login/page.tsx` with `login-page.tsx`.

**Do not touch the auth logic.** The new file has a placeholder marked `// [AUTH]`. Move the existing `handleSubmit` body (the sign-in call, router push, error handling) into it verbatim. If the current page pulls from a hook, context, or server action, keep that import and wire it the same way — the state variable names (`email`, `password`, `showPassword`, `loading`, `error`) were chosen to match common patterns, but rename them to whatever the current file uses rather than rewriting the logic.

---

## One dependency: the serif headline

The headline uses **Fraunces**. Without it the design falls back to Georgia and loses most of its character.

In `app/layout.tsx`:

```ts
import { Inter, Fraunces } from 'next/font/google'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })
const fraunces = Fraunces({
  subsets: ['latin'],
  weight: ['600'],
  variable: '--font-fraunces',
})

// on <html> or <body>:
// className={`${inter.variable} ${fraunces.variable}`}
```

Then make `font-serif` resolve to it.

**Tailwind v4** — in your CSS file:
```css
@theme {
  --font-serif: var(--font-fraunces), Georgia, serif;
  --font-sans: var(--font-inter), ui-sans-serif, system-ui, sans-serif;
}
```

**Tailwind v3** — in `tailwind.config.ts`:
```ts
theme: {
  extend: {
    fontFamily: {
      serif: ['var(--font-fraunces)', 'Georgia', 'serif'],
      sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
    },
  },
}
```

If you'd rather not add a font, swap `font-serif` for `font-sans` on the `<h1>` and bump it to `font-bold tracking-[-0.03em]`. It reads as a different (more generic) design, but it works.

---

## Design tokens

| Token | Value | Used for |
|---|---|---|
| Base | `#12172E` | page background |
| Sky | `#2C3564` → `#15193A` | SVG gradient |
| Ridges | `#4B5187`/`#2B3160`, `#2F3563`/`#1D2249`, `#1A1F42`/`#10142C` | back → front |
| Accent | `#F26B2B` (hover `#E05A1A`) | CTA, eyebrow, glow — unchanged from current |
| Card | `bg-white/[0.09]`, `border-white/[0.16]`, `backdrop-blur-xl` | glass panel |
| Body text | `text-white/65` | lede |
| Card radius | `18px` · Input/button radius `10px` | |

---

## Notes on the background

It's an inline SVG (three layered ridge paths + a radial glow + two gradient overlays), so there's no image request and nothing to optimize. It spans the full container — don't reintroduce a fixed height on the `<svg>` or you'll get a visible seam where it meets the base color.

If you later want a real photo of the Central Coast, replace the `<svg>` inside `CoastlineBackdrop` with:

```tsx
<Image src="/coast.jpg" alt="" fill priority className="object-cover" />
```

and keep both gradient overlay `<div>`s — they're what keeps the text legible over whatever's underneath.

---

## Acceptance checklist

- [ ] Sign-in still works end to end; error state renders in the card (`role="alert"`)
- [ ] Password toggle flips input type and swaps the icon
- [ ] Tab order: email → password → toggle → submit → remember → forgot
- [ ] Visible focus ring on every interactive element (the CTA uses `ring-offset-[#12172E]`)
- [ ] No seam or color band in the background at 1440px, 1280px, and 390px
- [ ] Stacks correctly under `lg` — copy above card, "Open an order" hidden below `sm`
- [ ] `backdrop-blur` degrades acceptably if unsupported (card stays readable at `bg-white/[0.09]`)
- [ ] `/open-order` and `/forgot-password` hrefs point at real routes — **change these if yours differ**

---

## Two things I'd flag

1. **`prefers-reduced-motion` isn't a concern** — there's no animation. If you add any, gate it.
2. **The glass card over a busy photo is the risk.** With the SVG it's fine; with a real photograph, check contrast at the card edges before shipping. The overlay opacities in `CoastlineBackdrop` are the dial to turn.
