import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, storeAsset, until, type TestRelay } from './helpers.ts';
import type { AssetRef } from '../../src/app/online/protocol/asset.ts';
import { png } from './png.ts';

// A player who reloads the page sees the map again without asking the GM for it: the page kept it in
// the browser. The built page (`npm run player:build`), a real relay, Chromium, and the plugin's own
// connection code as the GM, whose asset chunks go as bulk frames the page acks.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('a reload of the player page', () => {
  let test: TestRelay;
  let browser: Browser;
  let page: Page;
  let gm: TestGm;

  beforeAll(async () => {
    test = await startTestRelay();
    browser = await chromium.launch({ executablePath: CHROMIUM });
    page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  });

  afterAll(async () => {
    gm?.connection.stop();
    await browser?.close();
    await stopTestRelay(test);
  });

  /** The page's fetches of stored assets from the relay. */
  let fetched = 0;
  const requests = (): number => fetched;

  async function joinAndShow(map: AssetRef): Promise<string> {
    const seated = gm.joined.length;
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.click('.join-button');
    await until(() => gm.joined.length > seated, 'player seated', 10_000);
    const player = gm.joined.at(-1)?.id ?? '';
    gm.connection.send({ t: 'scene', scene: { id: 's1', map, lit: false } } as GmMessage, player);
    return player;
  }

  const mapShown = (): Promise<unknown> => page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 15_000 });

  it('shows the map from the browser\'s cache, and fetches it from the relay again once that copy is gone', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const bytes = png(900, 700, (x, y) => [(x * 7) % 256, (y * 13) % 256, (x ^ y) % 256]);
    const map = await storeAsset(test, bytes, 'image/png');
    page.on('request', (request) => {
      if (request.url().includes(`/api/assets/${map.id}`)) fetched += 1;
    });
    const url = `http://127.0.0.1:${test.relay.publicPort}/#${created.code}`;

    await page.goto(url);
    await joinAndShow(map);
    await until(() => requests() === 1, 'map fetched', 10_000);
    await mapShown();
    await page.waitForFunction((hash) => (localStorage.getItem('atlas-vtt:asset-cache-v1') ?? '').includes(hash), map.hash, { timeout: 5_000 });

    await page.reload();
    await joinAndShow(map);
    await mapShown();
    await page.waitForTimeout(500);
    expect(requests()).toBe(1);

    // Without the kept copy, the page fetches the map from the relay as before.
    await page.evaluate(() => caches.delete('atlas-vtt-assets-v1'));
    await page.reload();
    await joinAndShow(map);
    await until(() => requests() === 2, 'map fetched again', 10_000);
    await mapShown();
  });
});
