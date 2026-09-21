// src/lib/email-layout.ts

/**
 * One HTML shell for every email UBC Flow sends.
 *
 * Email is not the web. Mail clients strip <style> blocks, ignore flexbox and
 * grid, and Outlook renders through Word, so this is tables and inline styles
 * throughout, fixed at 600px, with a system font stack and no external CSS,
 * fonts or images. Colours are hard-coded rather than read from the CSS
 * variables in globals.css: there are no variables in an email, and a client
 * that inverts for dark mode does so on its own terms.
 *
 * Every caller sends `text` as well. That is not a legacy path: a plain-text
 * alternative is what screen readers and text-only clients read, and a message
 * with only an HTML part scores worse with spam filters.
 */

const BRAND = '#002145'; // UBC Blue, --brand
const INK = '#111111';
const MUTED = '#615f5c'; // --text-secondary
const FAINT = '#8b8985';
const LINE = '#e3e1de';
const PAPER = '#ffffff';
const WELL = '#f7f6f4'; // --surface
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
/** The wordmark is set in Outfit on the site (see .nav-logo in globals.css):
 *  700, uppercase, 0.015em tracking. Email cannot load a webfont, so Outfit
 *  is named first for the desktop clients that have it and the system stack
 *  catches everyone else. The tracking was .14em here, ten times the site's,
 *  which is what made it read as a different wordmark. */
const WORDMARK_FONT = `Outfit,${FONT}`;

/**
 * Absolute, and on the canonical host on purpose: ubcflow.com 308s to
 * www.ubcflow.com, and a mail image proxy that declines to follow a redirect
 * would simply show nothing.
 *
 * The mark cannot be inline SVG, which Gmail and Outlook strip, so it is a
 * PNG at 3x from the same paths as the nav (src/lib/mark.ts). It loads only
 * because of a Vercel firewall rule bypassing /email/: every other static
 * asset answers 429 to a non-browser fetcher, and an image proxy is one.
 *
 * The img carries the wordmark's own type styles. A client with images off
 * renders the alt text with them, so "UBC Flow" still arrives looking like
 * the wordmark rather than as a broken-image stub.
 */
const SITE = (process.env.NEXTAUTH_URL ?? 'https://www.ubcflow.com').replace(
  'https://ubcflow.com',
  'https://www.ubcflow.com',
);

/** Escapes text going into HTML. Assignment titles come from Canvas, which is
 *  to say from professors, and nothing stops one containing an angle bracket. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A heading above a group of rows. */
export function section(title: string): string {
  return `<tr><td style="padding:26px 0 8px;font:600 12px/1.4 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${FAINT};">${esc(title)}</td></tr>`;
}

/**
 * One deadline. `meta` is the course, `when` the due date, `note` an optional
 * line underneath such as what it moved from. Linked when a url is given.
 */
export function row(opts: {
  title: string;
  meta?: string;
  when?: string;
  note?: string;
  url?: string | null;
}): string {
  const title = opts.url
    ? `<a href="${esc(opts.url)}" style="color:${INK};text-decoration:none;">${esc(opts.title)}</a>`
    : esc(opts.title);
  const right = opts.when
    ? `<td align="right" valign="top" style="font:400 13px/1.5 ${FONT};color:${MUTED};white-space:nowrap;padding-left:12px;">${esc(opts.when)}</td>`
    : '';
  const meta = opts.meta
    ? `<div style="margin-top:3px;font:400 12px/1.5 ${FONT};color:${FAINT};">${esc(opts.meta)}</div>`
    : '';
  const note = opts.note
    ? `<div style="margin-top:3px;font:400 12px/1.5 ${FONT};color:${MUTED};">${esc(opts.note)}</div>`
    : '';
  return `<tr><td style="padding:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE};">
      <tr>
        <td style="padding:12px 0;font:600 15px/1.45 ${FONT};color:${INK};">${title}${meta}${note}</td>
        ${right}
      </tr>
    </table>
  </td></tr>`;
}

/** A paragraph of ordinary copy. */
export function para(text: string): string {
  return `<tr><td style="padding:0 0 14px;font:400 15px/1.6 ${FONT};color:${MUTED};">${esc(text)}</td></tr>`;
}

/** The one thing we want them to click. Bulletproof-ish: a table cell with a
 *  background colour, which is the only button every client renders. */
export function button(label: string, href: string): string {
  return `<tr><td style="padding:24px 0 18px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr><td bgcolor="${BRAND}" style="border-radius:999px;">
        <a href="${esc(href)}" style="display:inline-block;padding:12px 26px;font:600 15px/1 ${FONT};color:#ffffff;text-decoration:none;border-radius:999px;">${esc(label)}</a>
      </td></tr>
    </table>
  </td></tr>`;
}

/** The same destination as a plain link, for a client that eats the button. */
export function fallbackLink(href: string): string {
  // Belongs at the END of a message. A 64 character token wrapped over two
  // lines is the loudest thing on the page if it sits under the button, and
  // it is the path almost nobody takes.
  return `<tr><td style="padding:20px 0 0;border-top:1px solid ${LINE};font:400 11px/1.6 ${FONT};color:${FAINT};word-break:break-all;">Button not working? Paste this into your browser:<br><span style="color:${FAINT};">${esc(href)}</span></td></tr>`;
}

/**
 * Wraps content rows in the shell.
 *
 * `preheader` is the grey line a client shows next to the subject in the
 * inbox list. Left out, clients grab the first text they find, which is
 * usually the wordmark or a link.
 */
export function renderEmail(opts: {
  title: string;
  preheader: string;
  heading: string;
  rows: string;
  footer: string;
}): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(opts.title)}</title>
<!-- iOS Mail turns every date, time and number into a blue underlined link of
     its own accord. Every row here is a date, so left alone the message reads
     as a wall of links. This is the only way to refuse it. -->
<style>
  a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important;
    font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important;
    line-height: inherit !important; }
</style>
</head>
<body style="margin:0;padding:0;background:${WELL};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${WELL};">
  <tr><td align="center" style="padding:28px 12px;">

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${PAPER};border:1px solid ${LINE};border-radius:14px;">
      <tr><td style="padding:22px 28px 0;">
        <a href="${SITE}" style="text-decoration:none;">
          <img src="${SITE}/email/logo.png" alt="UBC Flow" width="140" height="33"
               style="display:block;width:140px;height:33px;border:0;outline:none;text-decoration:none;font:700 18px/33px ${WORDMARK_FONT};letter-spacing:.015em;color:${BRAND};text-transform:uppercase;">
        </a>
      </td></tr>

      <tr><td style="padding:14px 28px 0;font:700 22px/1.3 ${FONT};color:${INK};">${esc(opts.heading)}</td></tr>

      <tr><td style="padding:16px 28px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${opts.rows}</table>
      </td></tr>
    </table>

    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      <tr><td style="padding:16px 28px 0;font:400 12px/1.6 ${FONT};color:${FAINT};">${opts.footer}</td></tr>
    </table>

  </td></tr>
</table>
</body></html>`;
}

/** A footer line with an unsubscribe-style link, used by the Canvas mail. */
export function footerWithMute(muteUrl: string): string {
  return `You get these because you connected Canvas on UBC Flow.<br>
<a href="${esc(muteUrl)}" style="color:${MUTED};">Change lead times or stop them</a>`;
}

/** A footer for account mail, which has no unsubscribe: it is transactional. */
export const FOOTER_ACCOUNT =
  'You received this because someone used this address on ubcflow.com. If that was not you, you can ignore it.';
