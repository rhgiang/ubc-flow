import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Every file talks to the same Postgres, and several write shared
    // catalogue rows — run in parallel they delete each other's fixtures
    // mid-assertion, which showed up as a different test failing on every
    // other run. One file at a time costs about 40s and makes a red run mean
    // something.
    fileParallelism: false,
    // next-auth's ESM re-exports `next/server` without an extension; Next's
    // own package has no `exports` map, so Node's strict ESM resolver (used
    // for externalized deps) can't find it. Inlining routes resolution
    // through Vite instead, which resolves it fine.
    server: { deps: { inline: ['next-auth', '@auth/core'] } },
  },
});
