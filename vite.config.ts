import { defineConfig } from 'vitest/config';

// base './' keeps the build working from a GitHub Pages project subpath
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  test: { include: ['test/**/*.test.ts'], testTimeout: 120_000 },
});
