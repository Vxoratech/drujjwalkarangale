import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vite.config.ts',
    test: {
      name: 'unit',
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    },
  },
  {
    extends: './vite.config.ts',
    test: {
      name: 'db',
      environment: 'node',
      include: ['tests/db/**/*.test.ts'],
      testTimeout: 60000,
      hookTimeout: 120000,
    },
  },
]);
