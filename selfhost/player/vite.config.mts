import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import path from 'node:path';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../../tailwind.config.mts';

const repoRoot = path.resolve(__dirname, '../..');
// The plugin's stylesheet (styles/index.css and main.scss) is built here as the plugin builds it: its
// own PostCSS steps, with Tailwind told where the classes are from wherever the build runs.
const [tailwindEntry, nesting] = (createRequire(import.meta.url)(path.join(repoRoot, 'postcss.config.cjs')) as { plugins: unknown[] }).plugins;
const content = [path.join(repoRoot, 'src/**/*.{ts,tsx}'), path.join(__dirname, 'src/**/*.{ts,tsx}')];

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  css: {
    postcss: { plugins: [tailwindEntry, nesting, tailwindcss({ ...tailwindConfig, content }), autoprefixer()] as never[] },
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
