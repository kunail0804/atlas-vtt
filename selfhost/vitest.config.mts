import { defineConfig } from 'vitest/config';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..');

// The relay's tests run in Node against a real relay on random ports. The GM side of every test is
// the plugin's own connection code (src/app/online/gm/TableConnection.ts), not an imitation of it.
export default defineConfig({
  root: repoRoot,
  test: {
    name: 'selfhost',
    environment: 'node',
    include: ['selfhost/tests/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
