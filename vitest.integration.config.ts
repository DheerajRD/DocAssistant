import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      'server-only': resolve(dirname(fileURLToPath(import.meta.url)), 'tests/server-only.ts'),
      '@': resolve(dirname(fileURLToPath(import.meta.url)), 'src'),
    },
  },
  test: { include: ['tests/**/*.integration.test.ts'], testTimeout: 30000 },
});
