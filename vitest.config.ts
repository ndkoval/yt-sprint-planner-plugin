import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'artifacts/coverage',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/domain/**', 'src/backend/**'],
      // Domain calculations are the correctness-critical core; hold them to a high bar.
      thresholds: {
        'src/domain/**': {
          statements: 95,
          branches: 90,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
});
