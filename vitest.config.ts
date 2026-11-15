import { defineConfig } from 'vitest/config';

// Tests that import src/server run under plain Node so browser globals stay undefined there.
// A new server test belongs in this list, otherwise it runs in the dom project.
const nodeTests = [
  'tests/agent-installer.test.ts',
  'tests/booking-timeline.test.ts',
  'tests/clipboard-server.test.ts',
  'tests/dictation-launchd.test.ts',
  'tests/dictation-telemetry.test.ts',
  'tests/heif-pictures.test.ts',
  'tests/host-clipboard.test.ts',
  'tests/host-load.test.ts',
  'tests/host-stats-server.test.ts',
  'tests/kanban-strip-server.test.ts',
  'tests/mesh-inbox.test.ts',
  'tests/paired-route.test.ts',
  'tests/picture-depth-server.test.ts',
  'tests/picture-fetch-server.test.ts',
  'tests/repo-status-server.test.ts',
  'tests/server-host-service.test.ts',
  'tests/service-health.test.ts',
  'tests/toast-server.test.ts',
  'tests/weather-server.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: nodeTests },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          include: ['tests/**/*.test.ts'],
          exclude: nodeTests,
        },
      },
    ],
    // Report-only: no thresholds until someone has read a baseline report.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'html'],
      include: ['src/**/*.ts', 'packages/**/*.ts'],
      exclude: ['src/terminal/vendor/**'],
    },
  },
});
