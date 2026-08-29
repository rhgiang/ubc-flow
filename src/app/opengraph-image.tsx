import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { APP_NAME } from '@/lib/version';
import { CLOUD, WAVE_UPPER, WAVE_LOWER, MARK_VIEWBOX } from '@/lib/mark';

// Shared to Discord, iMessage, and Reddit far more often than it is linked
// from a page, so the card is the first thing most people see of the site.
export const alt = `${APP_NAME} · find courses and professors at UBC`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The wordmark face, committed rather than fetched.
 *
 * Satori ships one font and silently renders every weight in it, so the card
 * came out in a generic sans while the site's wordmark is Outfit Bold — the
 * one place the two were allowed to disagree, on the image most people see
 * first. next/font/google is no help here: it serves woff2, which Satori
 * cannot read.
 */
const outfitBold = readFileSync(join(process.cwd(), 'src/app/Outfit-Bold.ttf'));
// The tagline is body text on the site (Inter), but Inter ships only as an
// 876KB variable font — a lot of repository for one line on one image. Outfit
// Regular is 76KB and already in the family, and one face across a card reads
// as deliberate rather than as a mismatch.
const outfitRegular = readFileSync(join(process.cwd(), 'src/app/Outfit-Regular.ttf'));


export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          // The brand token from globals.css, not the near-black the OG
          // default would give us.
          background: '#002145',
          color: '#ffffff',
        }}
      >
        <svg width="200" height="200" viewBox={MARK_VIEWBOX}>
          <path fill="#ffffff" d={CLOUD} />
          <path fill="#ffffff" d={WAVE_UPPER} />
          <path fill="#ffffff" d={WAVE_LOWER} />
        </svg>
        {/* Matches .nav-logo in globals.css: Outfit Bold, uppercase, 0.015em. */}
        <div
          style={{
            display: 'flex',
            fontFamily: 'Outfit',
            fontSize: 96,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.015em',
            marginTop: 36,
          }}
        >
          {APP_NAME}
        </div>
        <div
          style={{
            display: 'flex',
            fontFamily: 'Outfit',
            fontSize: 38,
            fontWeight: 400,
            color: '#7aa7e8',
            marginTop: 12,
          }}
        >
          Find courses and professors at UBC
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Outfit', data: outfitRegular, weight: 400, style: 'normal' },
        { name: 'Outfit', data: outfitBold, weight: 700, style: 'normal' },
      ],
    },
  );
}
