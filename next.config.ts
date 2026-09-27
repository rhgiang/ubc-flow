import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Unchanged by default. Set NEXT_DIST_DIR to give a second server its own
  // build directory, so `next dev` can run against a working copy while a
  // `next start` keeps serving .next - otherwise the two fight over it and
  // the running server gets its chunks swapped out underneath it.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  experimental: {
    serverActions: {
      // The site is served at www.ubcflow.com, and the apex 308s to it. A 308
      // keeps the method and the body, so a Server Action POST that starts at
      // the apex is replayed at www still carrying `Origin: ubcflow.com`.
      // Next.js compares that origin against the host it arrived at, reads
      // the disagreement as CSRF, and aborts the action: "Invalid Server
      // Actions request.", digest @E80, which in practice meant a Helpful
      // vote quietly springing back. Naming our own apex here makes it what
      // it always was, the same site.
      allowedOrigins: ['ubcflow.com'],
    },
  },
  // /exams and /syllabus were their own pages and their own nav pills. Both
  // are now the Exams tab on /schedule, but people bookmarked them - so the
  // paths stay alive and land on that tab. A config redirect rather than two
  // stub pages: nothing is left to rot, and it's one place to read.
  async redirects() {
    return [
      { source: '/exams', destination: '/schedule?tab=exams', permanent: true },
      { source: '/syllabus', destination: '/schedule?tab=exams', permanent: true },
    ];
  },
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
      {
        // The syllabus viewer embeds this route in an <embed> on the same
        // origin. The blanket DENY/'none' above blocks that in every real
        // browser, same-origin included - this entry, being LAST in the
        // array, wins on these two keys for this path only (Next.js: last
        // matching header wins on key conflicts). Every other route keeps
        // the strict global rule.
        source: '/api/syllabus/:id/file',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
