import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // Report-only: no thresholds until someone has read a baseline report.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**', 'packages/**'],
      exclude: ['src/terminal/vendor/**'],
    },
  },
});
