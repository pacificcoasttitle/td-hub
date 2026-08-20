const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://hub.pctitle.com').replace(/\/+$/, '');
const PCT_WEBSITE_URL = 'https://www.pct.com';

/** Brand navy — main header, hero, and primary UI. */
export const PCT_NAVY = '#10213A';
/** Deep navy used for body text accents and the footer bar. */
export const PCT_DEEP = '#1B2A4A';
/** Main logo header background (redesign used #10213A; PCT brand navy preferred). */
export const HEADER_BG = PCT_NAVY;
export const HERO_BG = PCT_NAVY;
export const PCT_ORANGE = '#F26B2B';
export const ORANGE_SOFT = '#FF8A4C';
export const ORANGE_TINT = '#FFF0E8';
export const TEXT_PRIMARY = PCT_DEEP;
export const TEXT_MUTED = '#6B7280';
export const TEXT_BODY = '#4B5563';
export const BORDER_NAVY = PCT_NAVY;
export const BORDER_SOFT = '#E5E7EB';
export const BG_LIGHT = '#F3F4F6';
/** Near-white — pure #FFFFFF is the first thing dark-mode clients invert. */
export const CARD_BG = '#FEFEFE';
export const PCT_LIGHT_LOGO_PATH = '/logo2-light.png';
export const PCT_DARK_LOGO_PATH = '/logo2-dark.png';
export const PCT_LIGHT_LOGO_URL = `${APP_URL}${PCT_LIGHT_LOGO_PATH}`;
export const PCT_LOGO_URL = 'https://www.pct.com/logo2.png';
export const APP_BASE_URL = APP_URL;

export function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface EmailHero {
  icon: string;
  eyebrow: string;
  headline: string;
  subcopy: string;
}

export interface FieldRow {
  label: string;
  /** Already-escaped or trusted HTML (e.g. mailto links). */
  valueHtml: string;
}

/**
 * Head styles that keep PCT brand colors stable in dark mode.
 * - color-scheme: light only → Apple Mail prefers not to auto-invert
 * - prefers-color-scheme + data-ogsc/b → re-lock navy/orange when clients still invert
 */
function brandColorLockStyles(): string {
  return `<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<style type="text/css">
:root { color-scheme: light only; }
supported-color-schemes: light;
u + .body .pct-navy,
u + .body .pct-deep,
u + .body .pct-orange { background-image: linear-gradient(#00000000,#00000000) !important; }
@media (prefers-color-scheme: dark) {
  .pct-page { background-color: ${BG_LIGHT} !important; }
  .pct-card { background-color: ${CARD_BG} !important; }
  .pct-navy { background-color: ${HEADER_BG} !important; }
  .pct-deep { background-color: ${PCT_DEEP} !important; }
  .pct-orange { background-color: ${PCT_ORANGE} !important; }
  .pct-orange-tint { background-color: ${ORANGE_TINT} !important; }
  .pct-text-on-navy,
  .pct-text-on-navy h1,
  .pct-text-on-navy p,
  .pct-text-on-navy span,
  .pct-text-on-navy a { color: #ffffff !important; }
  .pct-text-eyebrow { color: ${ORANGE_SOFT} !important; }
  .pct-text-subcopy { color: #D8DEE8 !important; }
  .pct-text-body { color: ${TEXT_BODY} !important; }
  .pct-text-primary { color: ${TEXT_PRIMARY} !important; }
  .pct-cta,
  .pct-cta a { color: #ffffff !important; }
  .pct-link-orange { color: ${ORANGE_SOFT} !important; }
}
[data-ogsc] .pct-page,
[data-ogsb] .pct-page { background-color: ${BG_LIGHT} !important; }
[data-ogsc] .pct-card,
[data-ogsb] .pct-card { background-color: ${CARD_BG} !important; }
[data-ogsc] .pct-navy,
[data-ogsb] .pct-navy { background-color: ${HEADER_BG} !important; }
[data-ogsc] .pct-deep,
[data-ogsb] .pct-deep { background-color: ${PCT_DEEP} !important; }
[data-ogsc] .pct-orange,
[data-ogsb] .pct-orange { background-color: ${PCT_ORANGE} !important; }
[data-ogsc] .pct-text-on-navy,
[data-ogsc] .pct-text-on-navy h1,
[data-ogsc] .pct-text-on-navy p,
[data-ogsb] .pct-text-on-navy,
[data-ogsb] .pct-text-on-navy h1,
[data-ogsb] .pct-text-on-navy p { color: #ffffff !important; }
[data-ogsc] .pct-text-eyebrow,
[data-ogsb] .pct-text-eyebrow { color: ${ORANGE_SOFT} !important; }
[data-ogsc] .pct-cta,
[data-ogsc] .pct-cta a,
[data-ogsb] .pct-cta,
[data-ogsb] .pct-cta a { color: #ffffff !important; }
[data-ogsc] .pct-link-orange,
[data-ogsb] .pct-link-orange { color: ${ORANGE_SOFT} !important; }
</style>`;
}

/** Alternating borderless field rows (redesign). */
export function fieldRows(rows: FieldRow[]): string {
  return rows
    .map((row, i) => {
      const bg = i % 2 === 0 ? '#FAFAFA' : '#F3F4F6';
      return `<tr><td width="35%" valign="top" style="padding:14px 16px;background:${bg};color:${TEXT_MUTED};font-size:12px;line-height:1.45;text-transform:uppercase;letter-spacing:.5px;">${esc(row.label)}</td><td valign="top" style="padding:14px 16px;background:${bg};color:${TEXT_PRIMARY};font-size:14px;line-height:1.45;font-weight:bold;">${row.valueHtml}</td></tr>`;
    })
    .join('');
}

export function fieldTable(rows: FieldRow[]): string {
  if (rows.length === 0) return '';
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-radius:12px;overflow:hidden;">${fieldRows(rows)}</table>`;
}

/** @deprecated Prefer fieldTable — kept for callers that build one row at a time. */
export function detailsRow(label: string, value: string): string {
  return fieldRows([{ label, valueHtml: esc(value) }]);
}

export function sectionLabel(text: string): string {
  return `<p class="pct-text-primary" style="margin:0 0 10px;color:${TEXT_PRIMARY};font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;">${esc(text)}</p>`;
}

export function ctaButton(text: string, href: string, bg: string = PCT_ORANGE): string {
  const cls = bg === PCT_ORANGE ? 'pct-orange' : bg === PCT_DEEP || bg === HEADER_BG ? 'pct-deep' : 'pct-navy';
  return `<table role="presentation" class="pct-cta" cellspacing="0" cellpadding="0" border="0"><tr><td class="${cls}" bgcolor="${bg}" style="background:${bg};border-radius:8px;"><a href="${esc(href)}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:14px;line-height:1;font-weight:bold;text-decoration:none;">${esc(text)}</a></td></tr></table>`;
}

/** Legacy helper — orange CTA cell for older `<tr>${button(...)}</tr>` composition. */
export function button(text: string, href: string): string {
  return `<td class="pct-orange pct-cta" bgcolor="${PCT_ORANGE}" style="background:${PCT_ORANGE};border-radius:8px;"><a href="${esc(href)}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:14px;line-height:1;font-weight:bold;text-decoration:none;">${esc(text)}</a></td>`;
}

export function calloutBar(html: string): string {
  return `<table role="presentation" class="pct-orange-tint" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 0;background:${ORANGE_TINT};"><tr><td class="pct-orange" width="7" style="width:7px;background:${PCT_ORANGE};font-size:1px;line-height:1px;">&nbsp;</td><td class="pct-text-primary" style="padding:17px 19px;color:${TEXT_PRIMARY};font-size:14px;line-height:1.55;">${html}</td></tr></table>`;
}

function brandHeaderAndHero(badge: string, hero: EmailHero): string {
  return `<tr><td class="pct-navy pct-text-on-navy" bgcolor="${HEADER_BG}" style="background-color:${HEADER_BG};background:${HEADER_BG};padding:30px 34px 28px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td valign="middle"><img src="${PCT_LOGO_URL}" width="190" alt="Pacific Coast Title" style="display:block;width:190px;max-width:100%;height:auto;border:0;"></td>
<td align="right" valign="middle"><span class="pct-orange" style="display:inline-block;background-color:${PCT_ORANGE};background:${PCT_ORANGE};color:#ffffff;font-size:10px;line-height:1;font-weight:bold;letter-spacing:1.2px;padding:9px 12px;border-radius:999px;text-transform:uppercase;">${esc(badge)}</span></td>
</tr></table></td></tr>
<tr><td class="pct-orange" height="2" bgcolor="${PCT_ORANGE}" style="height:2px;background-color:${PCT_ORANGE};background:${PCT_ORANGE};font-size:1px;line-height:1px;">&nbsp;</td></tr>
<tr><td class="pct-navy pct-text-on-navy" bgcolor="${HEADER_BG}" style="background-color:${HEADER_BG};background:${HEADER_BG};padding:28px 34px 32px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
<td width="74" valign="top" style="padding-top:4px;"><div class="pct-orange" style="width:56px;height:56px;border-radius:50%;background-color:${PCT_ORANGE};background:${PCT_ORANGE};color:#ffffff;font-size:24px;line-height:56px;text-align:center;font-weight:bold;">${esc(hero.icon)}</div></td>
<td valign="top"><p class="pct-text-eyebrow" style="margin:0 0 8px;color:${ORANGE_SOFT};font-size:11px;line-height:1.2;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;">${esc(hero.eyebrow)}</p><h1 style="margin:0;color:#ffffff;font-size:30px;line-height:1.16;font-weight:bold;">${esc(hero.headline)}</h1><p class="pct-text-subcopy" style="margin:12px 0 0;color:#D8DEE8;font-size:15px;line-height:1.55;">${esc(hero.subcopy)}</p></td>
</tr></table></td></tr>`;
}

function brandFooter(): string {
  return `<tr><td class="pct-deep pct-text-on-navy" bgcolor="${PCT_DEEP}" style="background-color:${PCT_DEEP};background:${PCT_DEEP};padding:22px 34px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="color:#ffffff;font-size:12px;font-weight:bold;">Pacific Coast Title Company</td><td align="right" style="color:#D8DEE8;font-size:11px;">TD Hub &nbsp;&middot;&nbsp; <a class="pct-link-orange" href="${PCT_WEBSITE_URL}" style="color:${ORANGE_SOFT};text-decoration:none;">pct.com</a></td></tr></table>
</td></tr>`;
}

/**
 * Full redesign shell: logo header → hero → body → footer.
 * Main header uses HEADER_BG (#1B2A4A). Brand colors are locked for dark mode.
 */
export function emailShell(opts: {
  title: string;
  badge: string;
  preheader?: string;
  hero: EmailHero;
  bodyHtml: string;
}): string {
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(opts.title)}</title>
${brandColorLockStyles()}
</head>
<body class="body" style="margin:0;padding:0;background-color:${BG_LIGHT};background:${BG_LIGHT};font-family:Arial,Helvetica,sans-serif;color:${TEXT_BODY};">
${preheader}
<table role="presentation" class="pct-page" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${BG_LIGHT}" style="width:100%;background-color:${BG_LIGHT};background:${BG_LIGHT};padding:28px 12px;">
<tr><td align="center">
<table role="presentation" class="pct-card" width="640" cellspacing="0" cellpadding="0" border="0" bgcolor="${CARD_BG}" style="width:100%;max-width:640px;background-color:${CARD_BG};background:${CARD_BG};border-radius:18px;overflow:hidden;box-shadow:0 8px 30px rgba(16,33,58,.10);">
${brandHeaderAndHero(opts.badge, opts.hero)}
<tr><td class="pct-text-body" style="padding:32px 34px 36px;color:${TEXT_BODY};font-size:15px;line-height:1.65;background-color:${CARD_BG};background:${CARD_BG};">${opts.bodyHtml}</td></tr>
${brandFooter()}
</table></td></tr></table></body></html>`;
}

/**
 * Back-compat wrapper: badge = title, generic hero from title.
 * Prefer emailShell for new templates.
 */
export function emailLayout(title: string, bodyHtml: string): string {
  return emailShell({
    title,
    badge: title,
    hero: {
      icon: '✓',
      eyebrow: 'Notification',
      headline: title,
      subcopy: 'An update from Pacific Coast Title.',
    },
    bodyHtml,
  });
}
