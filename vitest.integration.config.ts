import { defineConfig } from 'vitest/config';

// Integration tests run against real databases started by Testcontainers (Docker required).
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
  },
});
