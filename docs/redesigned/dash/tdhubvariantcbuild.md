# TD Hub — Variant C build sheet
**Light page, lit cards.** Everything below is a diff against what's on `/sales/dashboard` today.
Page background, sidebar, and table layout stay exactly as they are. Nine changes, none structural.

---

## 0. What does *not* change

- `bg-[#F5F6FA]` page shell — keep it.
- `bg-[#1B2A4A]` sidebar — keep it (one tweak in §7, purely cosmetic).
- The Recent Orders table markup, pagination, and data flow.
- No `backdrop-filter` anywhere. That's the point of C — no paint cost, no Safari caveats.

---

## 1. The lit card — one shared component

This is the whole design. Build it once, use it for both KPI cards (and later Trends/Summary).

```tsx
// components/LitCard.tsx
export function LitCard({ children, className = "" }) {
  return (
    <div className={`relative overflow-hidden rounded-[18px] border border-white/10
                     bg-[linear-gradient(180deg,#2C3564_0%,#15193A_100%)]
                     shadow-[0_22px_55px_-26px_rgba(16,33,58,0.55)] ${className}`}>
      {/* orange hairline — straight off the email header */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-[2px]
                       bg-gradient-to-r from-[#F26B2B] to-transparent" />
      {/* the "lit" part: warm glow from the upper right */}
      <span className="pointer-events-none absolute inset-0
                       bg-[radial-gradient(120%_90%_at_82%_8%,rgba(242,107,43,0.30),transparent_55%)]" />
      <div className="relative px-6 py-[22px]">{children}</div>
    </div>
  )
}
```

Three details that make it read as *lit* rather than just dark:

1. The gradient is `#2C3564 → #15193A` — the login's sky gradient, not a flat `#1B2A4A`.
2. The glow is anchored at `82% 8%`, so both cards look lit from the same off-canvas source.
3. The border is `white/10`, not a darker navy. It catches the light instead of drawing a box.

---

## 2. Text colors inside a lit card

| Role | Class |
|---|---|
| Eyebrow (`PRODUCTION (MTD)`) | `text-[9.5px] font-extrabold uppercase tracking-[1.6px] text-white/50` |
| Hero number | `text-white` (see §3) |
| Sub-label (`Title`, `Purchase`) | `text-[10.5px] font-semibold tracking-[0.4px] text-white/45` |
| Sub-value | `text-[21px] font-extrabold tracking-[-0.5px] text-white` |
| Body / breakdown line | `text-[12.5px] leading-[1.7] text-white/[0.66]` |
| Emphasised figures in body | `text-[#FFA76B] font-bold` |
| Link (`View closed files →`) | `text-[#FFA76B] font-bold hover:text-white` |
| Positive pace line | `text-[#7FE3B5] font-semibold` |
| Down-vs-last-month chip | `bg-[#FF7878]/[0.14] text-[#FF9E9E] border border-[#FF7878]/[0.22] rounded-full px-[9px] py-1 text-[10.5px] font-bold` |

Note the orange shifts to `#FFA76B` on the dark card. `#F26B2B` muddies against navy — it's a
button color, not a text color.

---

## 3. Numbers get Fraunces

The single highest-leverage change. Fraunces is already loaded for the login headline.

```tsx
// $26,635
"font-serif font-bold text-[46px] leading-none tracking-[-0.035em] text-white tabular-nums"
// pipeline 20 / 13
"font-serif font-bold text-[38px] leading-none tracking-[-0.026em] text-[#F59E5B] tabular-nums"
```

`tabular-nums` matters here — these figures refresh and you don't want the layout twitching.

---

## 4. Nested strips stay glass

Inside a lit card the background *is* dark, so real glass works — same values as the login card,
same as the email's Property / File-number block:

```
"rounded-[14px] border border-white/[0.16] bg-white/[0.09] px-[18px] py-[15px]"
```

Use this for the pipeline Purchase/Refinance split if you want it boxed, and for any future
"current milestone" block. Dividers inside the card: `bg-white/10`, never a gray.

---

## 5. Sparklines

On the dark card the stroke moves to the light orange, and the pipeline's secondary lines go white:

```tsx
<path stroke="#F59E5B" strokeWidth={2.2} strokeLinecap="round" fill="none" />   // 6-mo trend
<path stroke="rgba(255,255,255,0.5)" strokeWidth={2} strokeLinecap="round" />   // opened / closed
```

If you ever add an area fill under the trend line: `fill="url(#g)"` with
`#F26B2B` at `0.28` → `0` top to bottom.

---

## 6. Yesterday strip + Recent Orders — light cards

These stay on white, but pick up the card language so they don't look like a different app:

```
"rounded-[18px] border border-[#10213A]/[0.07] bg-white
 shadow-[0_14px_40px_-24px_rgba(16,33,58,0.45)]"
```

Bars in the strip: `bg-gradient-to-b from-[#F59E5B] to-[#F26B2B]`, empty days a 3px `#E5E7EB` dash.
"Yest." label in `#C2551A`.

Inside the table, three swaps:

- Status pill: `bg-[#FFF4E4] text-[#B4621F] border border-[#FBE0BF] rounded-full`
- `View all orders →`: `text-[#C2551A]` (not `#F26B2B` — it fails contrast on white at 12.5px)
- **The green button goes.** `Review Prelim` → `bg-[#F26B2B] text-white shadow-[0_10px_22px_-12px_rgba(242,107,43,0.9)]`.
  `View Contacts` → `bg-white border border-[#DFE3EA] text-gray-700`.
  Green appears in neither the login nor the email; it's the one color breaking the system.

---

## 7. Sidebar — one cosmetic tweak

Keep `bg-[#1B2A4A]`. Just restyle the active item so it echoes the cards' warm light:

```tsx
// active
"mx-2.5 rounded-[10px] bg-gradient-to-r from-[#F26B2B]/[0.22] to-white/[0.05]
 text-white shadow-[inset_2px_0_0_#F26B2B]"
// idle
"mx-2.5 rounded-[10px] text-white/[0.68] hover:bg-white/[0.07] hover:text-white"
```

The current `border-l-[3px]` becomes an inset shadow so it works on a rounded pill.

---

## 8. Page header

`Welcome, David` → `font-serif text-[30px] font-semibold tracking-[-0.02em] text-[#10213A]`.
Ties the page to "Close with confidence." without touching anything else.

---

## 9. Order of operations

1. `LitCard` component + apply to Production and Pipeline. *(This alone is ~70% of the effect.)*
2. Fraunces on the hero numbers + page title.
3. Button/pill/link color swaps in the table.
4. Sidebar active state.
5. Yesterday strip + Orders card radius/shadow.

Then roll `LitCard` onto Trends, Summary, and Commission so the app doesn't end up half-converted.

## Checks before merge

- Contrast: `white/45` micro-labels on `#15193A` pass AA at 9.5px bold; `white/45` on the *top*
  of the gradient (`#2C3564`) is borderline — keep eyebrows in the upper padding where the glow
  lifts them, or bump to `white/55`.
- The glow layer must be `pointer-events-none` or it eats clicks on anything inside the card.
- `overflow-hidden` on the card is required — without it the hairline and glow square off the corners.
- Print styles: the gradient cards will render as dark blocks. If anyone prints this page, add
  `print:bg-white print:text-[#10213A] print:shadow-none` to `LitCard`.
