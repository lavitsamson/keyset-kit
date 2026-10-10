import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['test/types/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
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
