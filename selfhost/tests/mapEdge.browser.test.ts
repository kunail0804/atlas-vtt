import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, storeAsset, until, type TestRelay } from './helpers.ts';
import { png } from './png.ts';

// What lies beyond a lit map. The lighting draws over the map and over what its tokens' sight
// reaches beyond it, which walls cut off: past that, the page's own background showed as a band.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const RATIO = 1.25;
/** The page's background (`PAGE_BACKGROUND`). */
const BACKGROUND = [16, 17, 20];

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the page beyond a lit map', () => {
  let test: TestRelay;
  let browser: Browser;
  let page: Page;
  let gm: TestGm;

  beforeAll(async () => {
    test = await startTestRelay();
    browser = await chromium.launch({ executablePath: CHROMIUM });
    page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: RATIO });
  });

  afterAll(async () => {
    gm?.connection.stop();
    await browser?.close();
    await stopTestRelay(test);
  });

  /** The colours of one screenshot at `points`, in CSS pixels. */
  async function colours(points: readonly (readonly [number, number])[]): Promise<number[][]> {
    const shot = await page.screenshot();
    return page.evaluate(async ({ data, places, ratio }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0);
      return places.map(([x, y]) => [...(context?.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data ?? [])].slice(0, 3));
    }, { data: shot.toString('base64'), places: points, ratio: RATIO });
  }

  it('is the page background on every side, zoomed out, whatever the sight reaches', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const mapRef = await storeAsset(test, png(1000, 1000, () => [210, 210, 210]), 'image/png');
    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';
    const send = (body: GmMessage): void => gm.connection.send(body, player);
    send({ t: 'scene', scene: { id: 'lit', map: mapRef, lit: true } });
    // A room to the token's right: its sight reaches the map's diagonal everywhere but there.
    const walls = [[600, 300, 800, 300], [800, 300, 800, 700], [800, 700, 600, 700], [600, 700, 600, 300]].map((p) => ({ p }));
    send({ t: 'lighting', scene: 'lit', cellSize: 70, unitDistance: 5, walls, zones: [], senses: [] } as GmMessage);
    send({
      t: 'sight', scene: 'lit', lighting: { enabled: true, ambient: 0 }, lights: [], held: [],
      tokens: [{ id: 'f1f2f3f4f5f6f7f8f9f0fafb', x: 500, y: 500, size: 1, vision: { senses: [] }, light: { bright: 20, dim: 40, color: '#ffffff', intensity: 1, animation: 'none' } }],
    } as GmMessage);
    // Zoomed out once the page has framed the map: the map is a small square in the middle of the screen.
    await page.waitForTimeout(3_000);
    await page.mouse.move(600, 400);
    for (let step = 0; step < 3; step += 1) {
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(150);
    }
    // Beyond the map (about 176 px wide in the middle): just past each of its edges, where the
    // token's sight reaches, and at the screen's edges, where it does not; then the map itself, dark.
    const beyond = [[380, 400], [700, 400], [600, 170], [600, 630], [10, 400], [1190, 400], [600, 10]] as const;
    const deadline = Date.now() + 15_000;
    let seen: number[][] = [];
    for (;;) {
      seen = await colours([...beyond, [520, 320]]);
      const lit = (seen.at(-1)?.[0] ?? 255) < 10;
      if ((lit && seen.slice(0, beyond.length).every((rgb) => rgb.join() === BACKGROUND.join())) || Date.now() > deadline) break;
      await page.waitForTimeout(250);
    }
    // The map's dark parts are the lighting's: the scene is lit, the curtain lifted.
    expect(seen.at(-1)?.[0]).toBeLessThan(10);
    expect(seen.slice(0, beyond.length)).toEqual(beyond.map(() => BACKGROUND));
  }, 120_000);
});
