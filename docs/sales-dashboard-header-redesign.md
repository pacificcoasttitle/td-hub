Here's my read on those three sections.

The impression they currently give

The two blue cards are accurate but emotionally flat — they read like a monthly accounting statement rather than a sales tool. A rep looking at "$60,230" has no way to know if that's a good month or a bad one. There's no goal, no comparison to last month or last July, no pace indicator. The only forward-looking element is "Projected: $65,966" buried in small gray text at the bottom of the card, which is arguably the single most motivating number on the page.

The right card has a similar problem in reverse. "35 opened / 28 closed" sits there as two big orange numbers, but the relationship between them — the pull-through rate, the fact that seven opened files haven't converted — is left for the rep to calculate mentally. The purchase/refi/escrow splits are presented as equal-weight columns even though escrow (2 and 1) is rounding error next to purchase (21 and 17).

The Yesterday strip is the weakest of the three. It's a full-width white band holding one number and a run-on line of gray text, so it costs a lot of vertical real estate to deliver very little. It also has no context — is 2 closings a good yesterday? And it visually separates the two blue cards from the Recent Orders table without adding anything in between.

Enhancements I'd suggest

For the production card, add a goal or pace bar directly under the dollar figure. Something like a thin progress track showing $60,230 against a monthly target, with the projected figure marked on it. That single change turns a static number into a "how close am I" prompt, which is what actually drives rep behavior. Alongside it, a small delta chip — up or down versus June, and versus July of last year — would cost almost no space. You already have the year-over-year monthly data on the Trends page, so the numbers exist; they just aren't surfaced where the rep starts their day. Also consider demoting TSG at $0 or collapsing zero-value line items, since showing a zero every day trains people to ignore that row.

For the opened/closed card, I'd surface the conversion relationship explicitly — a pull-through percentage (28 of 35, 80%) and a count of files opened but not yet closed, made clickable so it filters the orders table. Right now the card tells the rep what happened; making the gap clickable tells them what to do next. I'd also consider a small sparkline behind or beneath each number showing the last six months, which gives instant trend context without a second click.

For the Yesterday section, I'd either fold it into the top row as a compact third card or convert it into a rolling "last 7 days" strip with a tiny bar per day. A single day of title production is noisy — two closings versus five means almost nothing in isolation — whereas a week-long strip shows momentum and fills that horizontal space with something worth the pixels. If you keep it as a daily snapshot, at least give it a comparison ("2 closed vs. 3 avg/day this month") and tighten it to a single line so it stops looking like an empty card.

One broader note: all three sections currently use identical visual weight for numbers of very different importance. Establishing a hierarchy — production and pace largest, splits secondary, escrow and TSG tertiary — would let a rep absorb the whole header in about two seconds instead of reading it left to right.

Want me to mock any of these up, or look at how the Summary and Commission pages handle the same data so the treatment stays consistent?

Yes a mockup would be wonderful.

10 steps
10 steps

The mockup is now rendered live in your dashboard tab so you can see it in context. It's a client-side overlay only — nothing was saved, and a page refresh puts everything back exactly as it was.

Production card. The dollar figure now sits against a goal ($75,000 is a placeholder — swap in your real target), with a pace bar underneath. The orange fill is actual production, the green tick at 88% is where the projection lands, so a rep sees "I'm at 80%, I'll finish around 88%" in one glance instead of doing arithmetic. Two delta chips in the corner handle month-over-month and year-over-year, both of which you already have data for on the Trends page. Title and Escrow keep their prominence with share percentages added, while TSG at zero drops into the muted footer line alongside the purchase/refi breakdown rather than occupying a full column. A six-month sparkline in the corner gives trend context without a click.

Pipeline card. Retitled from the implicit opened/closed pairing to something that names what it actually is. Pull-through percentage moved to the top right where it frames both numbers. The important addition is the orange button — "7 opened, not yet closed" — which turns the gap between 35 and 28 into a work queue. Wire it to filter the Recent Orders table and the card stops being a report and starts being a to-do. Escrow is dimmed in both splits since one or two files shouldn't compete visually with twenty-one.

Yesterday strip. Same height as before but doing considerably more. Yesterday's number keeps its place on the left, now with a comparison against the month's daily average so a rep knows whether two closings was a good day. The seven-day bar chart in the middle shows momentum and makes the weekend dip obvious, and the right side rolls up the week. This reframes a single noisy data point as a trend line.

A few notes on the data: the goal, the delta percentages, the sparkline shapes, and the daily bars are all illustrative since those values aren't exposed on the current page. Your real MTD, splits, projections, and yesterday's figures are unchanged from the live dashboard.

Want me to try a variant — for example a radial progress ring instead of the bar, or a version where the seven-day strip merges into the pipeline card to free up a full row?

That looks amazing. Can you give me a document of what you want claude to do to carry this out? Exactly the way you havre it a great look.

Here's the implementation spec. Hand this to Claude in your code editor as-is.

Sales Dashboard Header Redesign — Implementation Spec
Context

The file to change is the sales rep dashboard at /sales/dashboard. Three sections in the page header are being replaced: the Production (MTD) card, the Opened/Closed card, and the Yesterday strip beneath them. Everything below — Recent Orders and the rest of the page — stays untouched. The current container is a div.mb-6 holding a div.grid.grid-cols-1.md:grid-cols-2.gap-4.mb-4 (the two dark cards) followed by a div.bg-white.border.border-gray-200.rounded-xl.p-4 (the Yesterday strip). That structure stays; only the card internals change.

The goal is behavioral, not decorative. The current cards report what happened. The new cards should answer three questions a rep asks each morning: am I on pace, is that better or worse than before, and what should I touch today. Every change below serves one of those three.

Design tokens

Use the existing palette rather than introducing new colors. Card background is 
#1b2a4a, matching the current cards and the sidebar. Primary accent orange is 
#f26a21 with a lighter 
#ff8c4a used for gradient ends and secondary emphasis. Positive/projection green is 
#7de2b0, and the delta chip green is 
#4ade80 on a rgba(52,199,123,0.14) background; the negative equivalents are 
#ff8080 on rgba(255,107,107,0.14). Muted label text on navy is 
#93a4c4, with 
#8fa0bf for secondary and 
#6f809f for tertiary footer text. On the white strip, use 
#8a94a6 for labels, 
#5b6577 for body, and 
#c8d2e2 for inactive bars. Card radius is 12px and padding is 22px vertical, 24px horizontal. Font is Inter, already loaded.

Card one — Production (MTD)

The label row keeps "PRODUCTION (MTD)" at 11px, letter-spacing 1.2px, weight 600, and gains a right-aligned pair of delta chips: month-over-month and year-over-year, each rendered as a pill at 11px weight 600 with a ▲ or ▼ glyph, 3px by 8px padding, fully rounded. Both values come from data you already compute for the Trends page, so this should be a query reuse rather than new aggregation.

Below that, the primary figure renders at 40px, weight 700, letter-spacing -1px, followed inline at 13px by "of $75,000 goal" with the goal amount emphasized. The goal needs a real source. If reps have individual targets, pull from the rep record; if targets are team-level, fall back to that; if no target exists at all, hide the goal text and the pace bar entirely and keep the rest of the card, rather than showing a fabricated number.

The pace bar is the centerpiece. It's an 8px-tall rounded track at 10% white, with the fill as a left-to-right gradient from 
#f26a21 to 
#ff8c4a sized to actual-over-goal, clamped at 100%. A 2px green vertical marker sits at the projected-over-goal position, extending 5px above and below the track so it reads as a target pin rather than part of the fill. Under the bar, left side carries the percentage in orange plus the day-of-month pace ("day 30 of 31"), right side carries the projected dollar figure and its percentage in green. If projection exceeds goal, the marker clamps to 100% and the label should still show the true percentage.

The splits row sits under a 1px rgba(255,255,255,0.10) divider. Title and Escrow each render as an 11px muted label above a 19px weight-700 value, with the share percentage trailing at 11px weight 500 in muted gray. TSG comes out of this row. Any line item at zero should drop to the footer line automatically rather than being special-cased — the rule is that zero-value categories don't get a column. A six-month sparkline sits right-aligned in this row, 86 by 22 pixels, 2px stroke in 
#ff8c4a at 85% opacity, with a 2.8px filled dot on the final point. Set overflow: hidden; display: block on the SVG so the stroke doesn't bleed into the footer.

The footer row carries the purchase/refi/TSG breakdown at 11px in 
#6f809f on the left and the existing "View closed files →" link on the right at 12px in 
#cfd9ec.

Card two — Pipeline (MTD)

Retitle this card "PIPELINE (MTD)". The current heading is implicit and the two stats read as unrelated. Pull-through percentage goes top-right in the label row, computed as closed divided by opened, with the number itself at 13px weight 700 in green against an 11px muted label.

The body is a two-column grid with an 18px gap and a 1px left border on the second column. Each column leads with the count at 36px weight 700 in 
#f26a21, followed inline by the label at 12px weight 600 with 0.5px letter-spacing, and a 66-by-20 sparkline pushed to the right edge of that line in 
#8fa0bf. Beneath sits the purchase/refi/escrow split at 10px labels over 16px weight-700 values. Escrow gets opacity: 0.5 and weight 600 — it's real data but it shouldn't compete with a category ten times its size.

The footer, again under a divider, is the most important functional addition. A button reading "N opened, not yet closed → view files" renders as rgba(242,106,33,0.15) fill with a rgba(242,106,33,0.45) border, text in 
#ffb488 at 12px weight 600, 7px by 12px padding, 8px radius. N is opened minus closed. This must be a real link that navigates to the orders view pre-filtered to open files for the current month — that's the whole point of the element, and shipping it as a static label would waste it. If the count is zero, replace the button with a quiet green "all opened files closed" state. Projected opened and closed stay as 11px tertiary text on the right.

Section three — Last 7 Days strip

Replace the single-metric strip with a three-part flex row at the same 12px radius, 
#e5e7eb border, and 16px by 22px padding as the current card.

Left block, minimum width 210px: label reads "YESTERDAY · [DOW MON DD]" at 11px letter-spacing 1.1px. Below it, the closing count at 30px weight 700 in navy, then inline at 13px the dollar figure and opened count. A third line at 11px compares against the month's daily average, which requires computing closings-per-business-day for the current month.

Center block, separated by a 26px left pad and a 1px 
#eef0f4 divider: seven columns at 44px each, one per day, oldest to newest. Each column is a count at 11px weight 700 above a 22px-wide bar with 4px radius, bottom-aligned in a 46px box, above a 10px day abbreviation. Bar height scales to the week's max with an 8px floor for nonzero values; zero days render a 3px stub and an en dash instead of "0". The most recent day is the accent — bar in 
#f26a21, count in 
#f26a21, label in navy weight 700 reading "Yest." — while the rest use 
#c8d2e2 bars and 
#93a0b5 labels. Weekends will usually be empty, and that's fine; it makes the shape of the week legible.

Right block, right-aligned with margin-left: auto: "LAST 7 DAYS" label, the rollup at 18px weight 700 in navy, and a supporting line with opened count and best day.

Data requirements

Three things need to exist that may not today: a monthly production goal per rep, prior-month and prior-year-same-month production totals, and a daily series of closings, revenue, and openings for the trailing seven days. The six-month sparkline series for production, openings, and closings should come from whatever backs the Trends page. If any of these aren't available at build time, degrade the specific element rather than blocking the whole redesign — hide the pace bar without a goal, hide a chip without a comparison, hide the sparkline without a series.

Responsive and accessibility notes

The two cards are a two-column grid above the md breakpoint and stack below it. The seven-day strip should let the center block wrap below the left block on narrow screens rather than shrinking the bars. Don't rely on color alone for the delta chips — the ▲/▼ glyphs carry the meaning. Give the sparklines and the bar chart aria-label text summarizing the trend, and make sure the orange pipeline button is a real focusable anchor or button with a discernible name.

Reference implementation

The mockup currently on screen was produced by the code below. It uses inline styles because it was injected at runtime; convert to Tailwind classes consistent with the rest of the codebase, and replace the hardcoded values with real props. Treat it as a visual target rather than production code.

js
const NAVY='#1b2a4a', ORANGE='#f26a21', ORANGE2='#ff8c4a';

const spark=(vals,color,w=90,h=24)=>{
  const max=Math.max(...vals),min=Math.min(...vals);
  const pts=vals.map((v,i)=>`${(i/(vals.length-1)*w).toFixed(1)},${(h-((v-min)/((max-min)||1))*(h-4)-2).toFixed(1)}`).join(' ');
  const lastY=(h-((vals.at(-1)-min)/((max-min)||1))*(h-4)-2).toFixed(1);
  return `<svg width="${w}" height="${h}" style="overflow:hidden;display:block">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round" opacity=".85"/>
    <circle cx="${w}" cy="${lastY}" r="2.8" fill="${color}"/></svg>`;
};

const chip=(txt,up)=>`<span style="display:inline-flex;align-items:center;gap:4px;
  background:${up?'rgba(52,199,123,.14)':'rgba(255,107,107,.14)'};
  color:${up?'#4ade80':'#ff8080'};font-size:11px;font-weight:600;
  padding:3px 8px;border-radius:999px;letter-spacing:.2px">${up?'▲':'▼'} ${txt}</span>`;

// PRODUCTION CARD
`<div style="background:${NAVY};border-radius:12px;padding:22px 24px;color:#fff">
  <div style="display:flex;justify-content:space-between;align-items:flex-start">
    <div style="font-size:11px;letter-spacing:1.2px;color:#93a4c4;font-weight:600">PRODUCTION (MTD)</div>
    <div style="display:flex;gap:6px">${chip('12% vs Jun',1)}${chip("8% vs Jul '25",1)}</div>
  </div>
  <div style="display:flex;align-items:baseline;gap:12px;margin-top:6px">
    <div style="font-size:40px;font-weight:700;letter-spacing:-1px;line-height:1.1">$60,230</div>
    <div style="font-size:13px;color:#93a4c4">of <span style="color:#cfd9ec;font-weight:600">$75,000</span> goal</div>
  </div>
  <div style="margin-top:14px;position:relative">
    <div style="height:8px;border-radius:99px;background:rgba(255,255,255,.10);position:relative">
      <div style="position:absolute;left:0;top:0;bottom:0;width:80.3%;border-radius:99px;
        background:linear-gradient(90deg,${ORANGE},${ORANGE2})"></div>
      <div style="position:absolute;left:88%;top:-5px;bottom:-5px;width:2px;background:#7de2b0;border-radius:2px"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:7px;font-size:11px;color:#8fa0bf">
      <span><span style="color:${ORANGE2};font-weight:700">80%</span> to goal · day 30 of 31</span>
      <span style="color:#7de2b0;font-weight:600">Projected $65,966 (88%)</span>
    </div>
  </div>
  <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.10);
    display:flex;align-items:center;gap:26px;flex-wrap:wrap">
    <div><div style="font-size:11px;color:#8fa0bf;margin-bottom:2px">Title</div>
      <div style="font-size:19px;font-weight:700">$59,705 <span style="font-size:11px;font-weight:500;color:#8fa0bf">99%</span></div></div>
    <div><div style="font-size:11px;color:#8fa0bf;margin-bottom:2px">Escrow</div>
      <div style="font-size:19px;font-weight:700">$525 <span style="font-size:11px;font-weight:500;color:#8fa0bf">1%</span></div></div>
    <div style="margin-left:auto;text-align:right">
      <div style="font-size:10px;color:#7b8cab;letter-spacing:.4px">6-MO TREND</div>
      <div style="margin-top:2px">${spark([41,47,44,52,55,60],ORANGE2,86,22)}</div>
    </div>
  </div>
  <div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#6f809f">
    <span>Purchase $52,213 · Refi $8,017 · TSG $0</span>
    <a href="#" style="color:#cfd9ec;font-size:12px;text-decoration:none">View closed files →</a>
  </div>
</div>`

// PIPELINE CARD — key structural bits
`<div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:8px">
  <!-- col 1: 36px/700 count in ORANGE, 12px label, right-aligned 66x20 sparkline,
       then 10px/16px split trio with escrow at opacity .5 -->
  <!-- col 2: same, with border-left:1px solid rgba(255,255,255,.10); padding-left:18px -->
</div>
<div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.10);
  display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
  <a href="/sales/orders?status=open&period=mtd" style="display:inline-flex;align-items:center;gap:8px;
    background:rgba(242,106,33,.15);border:1px solid rgba(242,106,33,.45);color:#ffb488;
    font-size:12px;font-weight:600;padding:7px 12px;border-radius:8px;text-decoration:none">
    7 opened, not yet closed <span style="opacity:.8">→ view files</span></a>
  <span style="font-size:11px;color:#6f809f">Proj. opened 38 · Proj. closed 31</span>
</div>`

// SEVEN-DAY BARS
const days=[{d:'Thu',c:3},{d:'Fri',c:5},{d:'Sat',c:0},{d:'Sun',c:0},{d:'Mon',c:4},{d:'Tue',c:3},{d:'Wed',c:2}];
const mx=Math.max(...days.map(x=>x.c));
days.map((x,i)=>{
  const last=i===days.length-1;
  const h=x.c?Math.max(8,(x.c/mx)*46):3;
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:44px">
    <div style="font-size:11px;font-weight:700;color:${last?ORANGE:'#3d4b66'}">${x.c||'–'}</div>
    <div style="height:46px;display:flex;align-items:flex-end">
      <div style="width:22px;height:${h}px;border-radius:4px;background:${last?ORANGE:'#c8d2e2'}"></div></div>
    <div style="font-size:10px;color:${last?'#1b2a4a':'#93a0b5'};font-weight:${last?700:500}">${last?'Yest.':x.d}</div>
  </div>`;
}).join('');
Suggested build order

Ship the pace bar and delta chips first, since they deliver most of the behavioral change for the least data work. The pipeline card's clickable gap comes second and depends on the orders filter route existing. The seven-day strip comes last because it needs a new daily aggregate that the other two don't.

One caveat worth repeating for whoever builds this: the goal amount, both delta percentages, the sparkline series, and the daily bar values in the mockup are illustrative. Only the MTD dollars, splits, projections, opened/closed counts, and yesterday's figures came from your live data.
---

# Build overrides & corrections

*Appended by engineering. Everything above is Chrome's design spec, committed verbatim. Where this section conflicts with the
mockup, this section wins — these are decisions and codebase realities the spec was written without.*

## 1. No goal, no pace bar — elevate the projection instead

Reps do not set production targets, so there is no goal to render. Omit the goal text and the pace bar entirely (the spec's own
degrade path). In their place, **the projection becomes the card's forward-looking element** — "On pace to finish ~$X" — shown
prominently alongside the MoM/YoY delta chips.

Everything else on the Production card stays: the big MTD number, delta chips, Title/Escrow splits with share percentages, TSG
and any zero-value line item demoted to the footer, and the six-month sparkline.

## 2. No "N opened, not yet closed" work-queue button

**Omit this element entirely.** The mockup derives it as `opened − closed`, but those are different cohorts: `mtd.opens` counts
files opened this month while `mtd.closed` counts files closed this month, most of which were opened in earlier months. The
difference corresponds to no real set of files, so the button would show a count that disagrees with any list it linked to.

Defining it correctly would mean changing existing status/closing logic (deciding whether `completed` counts as closed, adding an
exclusion filter to the orders API, wiring URL params into the orders client). We are explicitly **not** doing that here.

The Pipeline card remains a display upgrade: opened/closed counts, pull-through, sparklines, escrow dimmed — no clickable queue,
no orders-filter wiring.

## 3. Pull-through comes from Managers Report, not `closed ÷ opened`

Use the authoritative `closingRatio` already carried on the dashboard payload (`src/app/api/sales/dashboard/route.ts` —
`closingRatio: { closed, total: f.closingRatio.created }`). It is a real cohort figure.

Do **not** hand-compute `closed ÷ opened` as the mockup does — that divides two mismatched cohorts and would put a second,
contradictory percentage on the same page. The number will read differently from the mockup's 80%, by design.

## 4. The bottom slot is role-aware — the manager widget must survive

The spec describes the third slot as the rep's Yesterday strip because it was written from a rep's view. In the real component
that slot is **already conditional** (`src/components/sales/dashboard-kpi.tsx`, `showBranchSplit = role === 'sales_manager'`):

- **Managers** see the Production-by-Branch widget (shipped separately, #113).
- **Reps** see the Yesterday strip.

The redesign replaces **only the rep's branch** of that conditional. The manager's Production-by-Branch widget must not be
removed, altered, or restyled. The slot stays `isManager ? BranchBreakdown : SevenDayStrip`.

## 5. Data sources — reuse, and what is genuinely new

| Element | Source |
|---|---|
| MoM / YoY delta chips | `/api/sales/trends` — `currentYear.months`, `priorYear.months` (`TrendMonth { month, openings, closings, revenue }`) |
| Six-month sparklines | Same trends series |
| MTD number, splits, projection, opened/closed | Existing dashboard payload |
| Pull-through | Existing `closingRatio` (see §3) |
| **7-day daily series** | **New rep-scoped aggregate** |

The existing `/api/sales/daily` endpoint is **not** reusable: it is manager-only (403 for reps) and returns a per-rep leaderboard
for a single day, not a rep's daily history.

Managers Report has no daily-by-rep endpoint either. The 7-day series is therefore built by bucketing `getClosings(month, year,
repName)` — whose `ClosingsEntry` carries `closedDate` and `revenue` per file — into days. This keeps the strip on the same
authoritative source as the rest of the card. The window may span two months, in which case two calls are made.

**Openings per day are not available** from that source and are not fabricated from a different one — the strip shows closings and
revenue per day, and the Yesterday block keeps using the existing MR `yesterday` figure (which does include opens). Mixing a
locally-derived openings count into an otherwise MR-sourced strip would invite exactly the reconciliation failure this dashboard
cannot afford.

## 6. Standing guardrails

- Change **only** the two top cards and the rep 7-day strip. Do not touch Recent Orders, the manager branch widget, or the CRM.
- Do not change existing status, closing, or aggregation logic.
- Convert the mockup's inline styles to Tailwind and existing tokens; the mockup is a visual target, not production code.
- No new dependencies.
- **Degrade, never fabricate**: hide a chip without its comparison, hide a sparkline without a series, hide the strip without a
  daily series.
- Accessibility: delta direction carried by ▲/▼ glyphs rather than colour alone; sparklines and the bar chart carry aria-labels.

## 7. Build order

1. Production card — delta chips, elevated projection, splits, sparkline (no pace bar).
2. Pipeline card — pull-through from `closingRatio`, escrow dimmed, opened/closed sparklines (no work-queue button).
3. Rep 7-day strip — new rep-scoped aggregate, with the manager branch widget preserved in that slot.
