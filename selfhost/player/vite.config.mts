import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  css: {
    preprocessorOptions: {
      scss: { quietDeps: true, silenceDeprecations: ['import', 'legacy-js-api'] },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // The page imports the plugin's shared code from ../../src, outside this folder.
    fs: { allow: [repoRoot] },
    // In development the page is served here and the sockets go to the relay's public side.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8788', ws: true },
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
});
