// scripts/make-brand-assets.ts
/**
 * Regenerates docs/brand/ from the mark and the fonts the site itself uses:
 *
 *   social-preview.png   1280x640, for GitHub's Settings > General > Social
 *                        preview. Deliberately the same composition as
 *                        src/app/opengraph-image.tsx, so a link to the repo
 *                        and a link to the site look like the same product.
 *   logo-light/dark.png  the README lockup, one per GitHub theme.
 *
 * The three paths are IMPORTED from src/lib/mark.ts rather than copied, which
 * is the point of having this script at all: that file carries a note saying
 * the mark already lives in two places and both must be changed together.
 * This is not a third place. Run it when the mark or the wordmark changes:
 *
 *   npx tsx scripts/make-brand-assets.ts
 *
 * The HTML it screenshots is written to a temp dir, not kept: it is a render
 * step, not a source file.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
// Imported, not parsed: these are the same three paths the nav wordmark and
// the OG card draw, so the brand assets cannot drift from the site.
import { CLOUD, WAVE_UPPER, WAVE_LOWER, MARK_VIEWBOX } from '../src/lib/mark';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const b64 = (p: string) => readFileSync(p).toString('base64');
const FONTS = `
  @font-face { font-family: Outfit; font-weight: 700;
    src: url(data:font/ttf;base64,${b64('src/app/Outfit-Bold.ttf')}) format('truetype'); }
  @font-face { font-family: Outfit; font-weight: 400;
    src: url(data:font/ttf;base64,${b64('src/app/Outfit-Regular.ttf')}) format('truetype'); }
`;
const svg = (size: number, fill: string) =>
  `<svg width="${size}" height="${size}" viewBox="${MARK_VIEWBOX}" xmlns="http://www.w3.org/2000/svg">
     <path fill="${fill}" d="${CLOUD}"/><path fill="${fill}" d="${WAVE_UPPER}"/><path fill="${fill}" d="${WAVE_LOWER}"/>
   </svg>`;
const page = (body: string, css: string) => `<!doctype html><meta charset="utf-8">
<style>${FONTS} *{margin:0;padding:0;box-sizing:border-box} body{font-family:Outfit,sans-serif}${css}</style>${body}`;

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), 'ubcflow-brand-'));
  const b = await chromium.launch();

  // The social preview: the site's own OG card, at GitHub's 2:1.
  writeFileSync(join(tmp, 'social.html'), page(
    `<div class="card">${svg(200, '#ffffff')}
       <div class="word">UBC Flow</div>
       <div class="tag">Find courses and professors at UBC</div></div>`,
    `.card{width:1280px;height:640px;background:#002145;color:#fff;display:flex;
       flex-direction:column;align-items:center;justify-content:center}
     .word{font-weight:700;font-size:96px;text-transform:uppercase;letter-spacing:.015em;margin-top:36px}
     .tag{font-weight:400;font-size:38px;color:#7aa7e8;margin-top:12px}`));
  const sp = await b.newPage({ viewport: { width: 1280, height: 640 } });
  await sp.goto(pathToFileURL(join(tmp, 'social.html')).href, { waitUntil: 'networkidle' });
  await sp.screenshot({ path: 'docs/brand/social-preview.png' });
  await sp.close();

  // The README lockup, one per GitHub theme, transparent behind it.
  for (const [name, colour] of [['light', '#002145'], ['dark', '#ffffff']] as const) {
    writeFileSync(join(tmp, `logo-${name}.html`), page(
      `<div class="row">${svg(72, colour)}<div class="word">UBC Flow</div></div>`,
      `.row{display:inline-flex;align-items:center;gap:18px;padding:8px}
       .word{font-weight:700;font-size:64px;text-transform:uppercase;letter-spacing:.015em;color:${colour}}`));
    const p = await b.newPage({ viewport: { width: 900, height: 220 }, deviceScaleFactor: 2 });
    await p.goto(pathToFileURL(join(tmp, `logo-${name}.html`)).href, { waitUntil: 'networkidle' });
    await p.locator('.row').screenshot({ path: `docs/brand/logo-${name}.png`, omitBackground: true });
    await p.close();
  }
  await b.close();
  console.log('written');
}
main();
