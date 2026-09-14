import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/upload/**', '**/p2_extracted/**', '**/p4-extracted/**'],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
