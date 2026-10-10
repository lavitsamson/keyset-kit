import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          typecheck: {
            enabled: true,
            include: ['test/types/**/*.test-d.ts'],
            tsconfig: './tsconfig.json',
          },
        },
      },
      {
        // Real databases started by Testcontainers (Docker required).
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
    // Thresholds apply to the combined unit + integration run (`pnpm test:coverage`):
    // some adapter paths are only meaningful against a real database.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', 'lcov'],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90,
        'src/core/**': { lines: 95, functions: 95, branches: 95, statements: 95 },
      },
    },
  },
});
