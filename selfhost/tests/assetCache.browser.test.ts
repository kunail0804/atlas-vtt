import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

// The player page's asset cache in Chromium's real Cache Storage: what it keeps, what it refuses,
// and that it stays within its limits. The module is bundled as it stands and loaded into a blank
// page on 127.0.0.1, where the browser grants Cache Storage. Skipped where no Chromium is installed.
const CHROMIUM = '/usr/bin/chromium';
const MODULE = path.join(import.meta.dirname, '..', 'player', 'src', 'assetCache.ts');

/** Runs in the page: the cache module, and helpers to make assets and list what the storage holds. */
const HELPERS = `
window.assetOf = async (size, fill) => {
  const bytes = new Uint8Array(size).fill(fill);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { blob: new Blob([bytes], { type: 'image/webp' }), hash, drawSize: null };
};
window.storedKeys = async () => (await (await caches.open('atlas-vtt-assets-v1')).keys()).map((request) => new URL(request.url).pathname.split('/').pop()).sort();
`;

describe.skipIf(!existsSync(CHROMIUM))('the player page\'s asset cache', () => {
  let server: Server;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const bundled = await build({ entryPoints: [MODULE], bundle: true, format: 'iife', globalName: 'AtlasCache', write: false });
    server = createServer((_, response) => response.end('<!doctype html><title>cache</title>'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ executablePath: CHROMIUM });
    page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    await page.addScriptTag({ content: (bundled.outputFiles[0]?.text ?? '') + HELPERS });
  });

  afterEach(async () => {
    await page.evaluate(async () => {
      await caches.delete('atlas-vtt-assets-v1');
      localStorage.clear();
    });
  });

  afterAll(async () => {
    await browser?.close();
    server?.close();
  });

  it('gives back what it kept, with its hash and the size to draw it at', async () => {
    const result = await page.evaluate(async () => {
      const cache = new AtlasCache.AssetCache();
      const map = await assetOf(1000, 1);
      await cache.put('a@8192', { ...map, drawSize: { width: 1448, height: 1086 } });
      const kept = await cache.get('a@8192');
      const bytes = new Uint8Array(await (kept?.blob ?? new Blob()).arrayBuffer());
      return { same: kept?.hash === map.hash, drawSize: kept?.drawSize, length: bytes.length, every: bytes.every((byte) => byte === 1), missing: await cache.get('missing@full') };
    });
    expect(result).toEqual({ same: true, drawSize: { width: 1448, height: 1086 }, length: 1000, every: true, missing: null });
  });

  it('drops an entry whose bytes no longer match their hash instead of giving it back', async () => {
    const result = await page.evaluate(async () => {
      const cache = new AtlasCache.AssetCache();
      const map = await assetOf(1000, 1);
      await cache.put('a@full', map);
      const storage = await caches.open('atlas-vtt-assets-v1');
      await storage.put('/__atlas-asset-cache/a@full', new Response(new Uint8Array(1000).fill(2), { headers: { 'x-hash': map.hash } }));
      return { read: await cache.get('a@full'), left: await storedKeys() };
    });
    expect(result).toEqual({ read: null, left: [] });
  });

  it('stays within its byte budget, the least recently used out first', async () => {
    const kept = await page.evaluate(async () => {
      const cache = new AtlasCache.AssetCache({ budgetBytes: 10_000 });
      for (const [index, key] of ['one', 'two', 'three', 'four'].entries()) await cache.put(`${key}@full`, await assetOf(2_000, index));
      await new Promise((resolve) => setTimeout(resolve, 5));
      // Reading `one` makes `two` the least recently used.
      await cache.get('one@full');
      await cache.put('five@full', await assetOf(2_000, 5));
      await cache.put('six@full', await assetOf(2_000, 6));
      return storedKeys();
    });
    expect(kept).toEqual(['five@full', 'four@full', 'one@full', 'six@full', 'three@full']);
  });

  it('keeps at most its number of entries, and refuses an asset larger than a quarter of its budget', async () => {
    const kept = await page.evaluate(async () => {
      const cache = new AtlasCache.AssetCache({ budgetBytes: 100_000, maxEntries: 3 });
      for (const [index, key] of ['a', 'b', 'c', 'd'].entries()) await cache.put(`${key}@full`, await assetOf(10, index));
      await cache.put('huge@full', await assetOf(25_001, 9));
      return storedKeys();
    });
    expect(kept).toEqual(['b@full', 'c@full', 'd@full']);
  });

  it('remembers its index across pages, and drops entries the index does not name', async () => {
    const result = await page.evaluate(async () => {
      const first = new AtlasCache.AssetCache({ budgetBytes: 10_000 });
      await first.put('kept@full', await assetOf(2_000, 1));
      // The index is written a second after a change.
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      // An entry written behind the index's back (another tab) would escape the budget.
      const storage = await caches.open('atlas-vtt-assets-v1');
      await storage.put('/__atlas-asset-cache/stray@full', new Response(new Uint8Array(10)));
      const second = new AtlasCache.AssetCache({ budgetBytes: 10_000 });
      return { kept: (await second.get('kept@full')) !== null, left: await storedKeys() };
    });
    expect(result).toEqual({ kept: true, left: ['kept@full'] });
  });
});

declare global {
  const AtlasCache: typeof import('../player/src/assetCache.ts');
  function assetOf(size: number, fill: number): Promise<{ blob: Blob; hash: string; drawSize: null }>;
  function storedKeys(): Promise<string[]>;
}
