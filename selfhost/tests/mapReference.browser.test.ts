import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, storeAsset, until, type TestRelay } from './helpers.ts';
import { png } from './png.ts';

// The GM's Atlas hands a scene's map first as its tile pyramid; this relay refuses pyramids, and the
// GM hands the same scene again with the map as one image: the same hash under another id. The built
// page (`npm run player:build`), a real relay, Chromium, and the plugin's own connection code as the GM.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const MAP_W = 800;
const MAP_H = 600;

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('a map handed again as an image', () => {
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

  it('is shown in place of the pyramid this relay does not serve', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const image = await storeAsset(test, png(MAP_W, MAP_H, () => [40, 160, 60]), 'image/png');

    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';
    const send = (body: GmMessage): void => gm.connection.send(body, player);

    send({ t: 'scene', scene: { id: 's1', map: { ...image, id: 'f'.repeat(64), tiles: true }, lit: false } });
    await page.waitForTimeout(300);
    send({ t: 'scene', scene: { id: 's1', map: image, lit: false } });

    await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });
    await page.waitForTimeout(300);
    const shot = await page.screenshot();
    // The map is framed in the middle of the canvas.
    const centre = await page.evaluate(async (data) => {
      const picture = new Image();
      picture.src = `data:image/png;base64,${data}`;
      await picture.decode();
      const canvas = new OffscreenCanvas(picture.width, picture.height);
      const context = canvas.getContext('2d');
      context?.drawImage(picture, 0, 0);
      return [...(context?.getImageData(500, 350, 1, 1).data ?? [])];
    }, shot.toString('base64'));
    expect(centre.slice(0, 3)).toEqual([40, 160, 60]);
  });
});
