import { beforeAll, describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { readFileSync } from 'node:fs';

let eslint: ESLint;
// The first typed lint loads the whole project; keep that work outside each assertion.
beforeAll(async () => {
  eslint = new ESLint();
  await eslint.lintText('export {};', { filePath: 'src/app/host/dom.ts' });
}, 60_000);

describe('shared source enforcement', () => {
  it.each(['fetch', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'indexedDB', 'window.indexedDB', "globalThis['WebSocket']"])(
    'rejects access to %s', async expression => {
      const [result] = await eslint.lintText(`export const forbidden = ${expression};`, { filePath: 'src/app/host/dom.ts' });
      expect(result.messages.some(message => message.ruleId === 'no-restricted-globals')).toBe(true);
    },
  );

  it.each(['obsidian', 'node:fs', '../plugin/service', 'src/app/types'])(
    'rejects imports from %s', async specifier => {
      const [result] = await eslint.lintText(`import '${specifier}';`, { filePath: 'src/app/host/dom.ts' });
      expect(result.messages.some(message => message.ruleId === 'no-restricted-imports')).toBe(true);
    },
  );

  it('checks dependencies before building in ci.yml', () => {
    const source = readFileSync('.github/workflows/ci.yml', 'utf8');
    const check = source.indexOf('run: npm run check:boundaries');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(source.indexOf('run: npm run build:ci'));
  });
});
