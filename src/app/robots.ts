import type { MetadataRoute } from 'next';

const SITE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      // Per-user or transactional pages: nothing for a search engine here,
      // and /verify and /reset are token-bearing URLs that should never be
      // crawled from a leaked link.
      disallow: ['/schedule', '/onboarding', '/api/', '/verify', '/reset', '/login', '/signup', '/explore?*'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
