# TD Hub — favicon set

Sunset over the Pacific: orange tile, white sun, navy horizon. Same accent
(`#F26B2B` family) and navy (`#161B36`) as the Coastline login, so the tab
icon and the page read as one thing.

Chosen over a navy-tile version because orange survives both light and dark
Chrome tab bars — a navy icon disappears into a dark tab strip.

## Where the files go

Next.js App Router picks these up automatically from `app/` by filename.
**No `<link>` tags needed** — don't add any, Next injects them.

```
app/favicon.ico          ← 16 · 32 · 48 · 64 · 128 · 256, multi-res
app/icon.svg             ← what modern browsers actually use; scales cleanly
app/apple-icon.png       ← 180×180, opaque, full-bleed (iOS applies its own
                           corner mask — pre-rounded corners would show gaps)
```

Delete any existing `app/favicon.ico`, `app/icon.*`, or `public/favicon.ico`
first. A stale `public/favicon.ico` wins over `app/` and will silently
override this.

## Optional — PWA / home screen

```
public/icon-192.png
public/icon-512.png
public/icon-maskable-512.png   ← art pulled into the 80% safe zone
```

In `app/manifest.ts`:

```ts
icons: [
  { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
  { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
]
```

Skip this entirely if TD Hub isn't installable — it's dead weight otherwise.

## Verifying

Browsers cache favicons aggressively and ignore normal hard-refresh. After
deploying, check in a private window, or hit `/favicon.ico` directly.
Vercel preview URLs are a clean way to see it without cache interference.
