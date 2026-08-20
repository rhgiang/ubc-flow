import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // next-auth's ESM re-exports `next/server` without an extension; Next's
    // own package has no `exports` map, so Node's strict ESM resolver (used
    // for externalized deps) can't find it. Inlining routes resolution
    // through Vite instead, which resolves it fine.
    server: { deps: { inline: ['next-auth', '@auth/core'] } },
  },
});
