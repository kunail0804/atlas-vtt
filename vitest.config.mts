import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { motionNativeAnimation } from './vite/motion-native-animation.mts';

const alias = {
  '@': '/src',
  src: '/src',
  obsidian: '/tests/mocks/obsidian.ts',
  // Its `main` is a UMD bundle that Node loads with a second, CommonJS copy of pixi.js; the ESM build shares the app's.
  // A path on disk: the browser project's dependency optimizer reads it as one, and finds no `/node_modules` at the disk's root.
  'pixi-viewport': fileURLToPath(new URL('./node_modules/pixi-viewport/dist/pixi_viewport.js', import.meta.url)),
};

/**
 * Test files that take a CI runner ten seconds or more each (the rooms mode's carving fuzz, the eraser
 * on large fills): the `slow` project, run only by hand (`npm run test:slow`)
 * when the code they cover changes. Never in CI: they held the unit shards at their 15 minute limit.
 */
const SLOW_TEST_FILES = [
  'tests/unit/wallCarvingFuzz.test.ts',
  'src/app/annotations/__tests__/{eraseCutLarge,fillWindowCut}.test.ts',
];

export default defineConfig({
  // Dev tooling (e.g. disk-backed template loading) is enabled under test so
  // the maintainer-facing code paths are exercised. Mirrors the Vite `define`.
  define: {
  },
  resolve: { alias },
  // The browser tests run the animation library as the bundle has it (`vite/motion-native-animation.mts`).
  plugins: [motionNativeAnimation()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          // A test that needs a DOM says so on its first line: `// @vitest-environment jsdom`. jsdom costs a file about 0.4 s.
          environment: 'node',
          // Threads hand modules to the workers over a MessagePort, much cheaper than forks' IPC; most of a run is imports.
          pool: 'threads',
          // A CI runner is several times slower than a developer's machine; the dungeon suites take seconds a test there.
          testTimeout: process.env.CI ? 30_000 : 5_000,
          globals: true,
          setupFiles: ['./tests/setup/obsidianDom.ts', './tests/setup/domHost.ts'],
          // Agents' worktrees in `.claude/` hold whole copies of the repository. selfhost/ has its own suite
          // (npm test in selfhost/), which drives a built page in Chromium.
          exclude: ['**/node_modules/**', '**/.claude/**', '**/*.gpu.test.ts', 'selfhost/**', ...SLOW_TEST_FILES],
        },
      },
      {
        extends: true,
        test: {
          name: 'slow',
          environment: 'node',
          pool: 'threads',
          testTimeout: 120_000,
          globals: true,
          setupFiles: ['./tests/setup/obsidianDom.ts', './tests/setup/domHost.ts'],
          include: SLOW_TEST_FILES,
          exclude: ['**/node_modules/**', '**/.claude/**', '**/*.gpu.test.ts'],
        },
      },
      {
        extends: true,
        // Found only while a test runs, a dependency reloads that test: the Obsidian mock imports
        // `yaml`, the app manager's test `pixi-viewport`, the dice morph test React's DOM.
        optimizeDeps: { include: ['yaml', 'pixi-viewport', 'eventemitter3', 'react-dom', 'react-dom/client', 'react/jsx-dev-runtime'] },
        test: {
          name: 'gpu',
          // Obsidian's helpers on the DOM (`createEl`, `el.win`), which map views use as in Obsidian.
          setupFiles: ['./tests/setup/obsidianDom.ts', './tests/setup/domHost.ts'],
          include: ['src/**/*.gpu.test.ts', 'tests/**/*.gpu.test.ts'],
          testTimeout: 600_000,
          browser: {
            enabled: true,
            headless: true,
            // Headless Chromium on Linux renders WebGL in SwiftShader, on the CPU. `REAL_GPU=1` asks it for the GPU
            // (`--enable-gpu`, ANGLE on OpenGL ES). Opt-in: tests that compare pixel hashes were recorded on SwiftShader.
            provider: playwright({
              launchOptions: {
                channel: 'chromium',
                args: process.env.REAL_GPU ? ['--enable-gpu'] : [],
                ignoreDefaultArgs: ['--hide-scrollbars'],
              },
            }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        extends: true,
        // The sound engine's rendered proofs, on the other engine players' browsers use: local only, as the gpu project.
        test: {
          name: 'sound-webkit',
          setupFiles: ['./tests/setup/obsidianDom.ts', './tests/setup/domHost.ts'],
          include: ['tests/gpu/sound/{soundSeams,soundTransitions,soundFiles}.gpu.test.ts'],
          testTimeout: 600_000,
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'webkit' }],
          },
        },
      },
    ],
  },
});
