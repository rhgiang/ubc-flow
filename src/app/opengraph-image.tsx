import { ImageResponse } from 'next/og';
import { APP_NAME } from '@/lib/version';
import { CLOUD, WAVE_UPPER, WAVE_LOWER, MARK_VIEWBOX } from '@/lib/mark';

// Shared to Discord, iMessage, and Reddit far more often than it is linked
// from a page, so the card is the first thing most people see of the site.
export const alt = `${APP_NAME} · find courses and professors at UBC`;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';


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
        {/* ponytail: no fontWeight — Satori only has the one face bundled with
            next/og, so a bold request silently renders regular. To match the
            Outfit Bold wordmark in the nav, commit the .ttf and pass it via
            the ImageResponse `fonts` option. */}
        <div style={{ display: 'flex', fontSize: 96, marginTop: 36 }}>{APP_NAME}</div>
        <div style={{ display: 'flex', fontSize: 38, color: '#7aa7e8', marginTop: 12 }}>
          Find courses and professors at UBC
        </div>
      </div>
    ),
    size,
  );
}
