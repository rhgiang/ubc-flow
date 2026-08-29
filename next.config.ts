import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // The login form must never render inside someone else's iframe.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // ponytail: no script-src CSP. The theme-init inline script in
          // layout.tsx would force 'unsafe-inline', which is a CSP in name
          // only; a real one needs the nonce-via-middleware setup.
        ],
      },
    ];
  },
};

export default nextConfig;
