import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, storeAsset, until, type TestRelay } from './helpers.ts';
import { png } from './png.ts';

// The player's own token as the GM's map draws it: the ring's artwork, and the bars of resources
// players at large do not see, which only the `mine` message carries.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const MAP_W = 1000;
const MAP_H = 600;
const TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const TOKEN_AT = { x: 300, y: 300 };

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the player\'s own token', () => {
  let test: TestRelay;
  let browser: Browser;
  let page: Page;
  let gm: TestGm;

  beforeAll(async () => {
    test = await startTestRelay();
    browser = await chromium.launch({ executablePath: CHROMIUM });
    page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  });

  afterAll(async () => {
    gm?.connection.stop();
    await browser?.close();
    await stopTestRelay(test);
  });

  it('shows its ring\'s artwork and its owner\'s bars', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const mapBytes = png(MAP_W, MAP_H, () => [40, 160, 60]);
    const mapRef = await storeAsset(test, mapBytes, 'image/png');
    const send = (body: GmMessage, to: string): void => gm.connection.send(body, to);

    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';

    send({ t: 'scene', scene: { id: 's1', map: mapRef, lit: false } }, player);
    // Everyone's list carries no bar: the GM keeps hit points from players at large.
    const ui = { nameplate: false, downed: false, bars: [], conditions: [] };
    send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens: [{ id: TOKEN, ...TOKEN_AT, size: 140, cells: 2, rotation: 0, art: null, name: 'Mira', ring: { colour: '#ffffff', size: 160 }, claim: 'taken', badge: null, ui }] }, player);
    send({ t: 'mine', scene: 's1', tokens: [TOKEN], bars: { [TOKEN]: [{ colour: '#22c55e', direction: 'drains', defeats: true, current: 30, max: 30 }] } }, player);
    await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });
    await page.waitForTimeout(500);

    const scale = Math.min(1200 / (MAP_W * 1.05), 800 / (MAP_H * 1.05));
    const screen = (x: number, y: number): { x: number; y: number } => ({ x: 600 + (x - MAP_W / 2) * scale, y: 400 + (y - MAP_H / 2) * scale });
    const shot = await page.screenshot();
    if (process.env.ATLAS_SHOTS) await page.screenshot({ path: path.join(process.env.ATLAS_SHOTS, 'own-token.png'), clip: { x: screen(200, 200).x, y: screen(200, 200).y, width: 200 * scale, height: 220 * scale } });
    const pixel = async (x: number, y: number): Promise<number[]> => page.evaluate(async ({ data, px, py }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0);
      return [...(context?.getImageData(Math.round(px), Math.round(py), 1, 1).data ?? [])];
    }, { data: shot.toString('base64'), px: x, py: y });

    // The bar under the ring (outer 160), full, in the resource's green.
    const bar = await pixel(screen(TOKEN_AT.x, TOKEN_AT.y + 80 + 6).x, screen(TOKEN_AT.x, TOKEN_AT.y + 80 + 6).y);
    expect(bar.slice(0, 3)).toEqual([0x22, 0xc5, 0x5e]);
    // The ring's artwork is stone over the art's edge, as on the GM's map: its greys vary from one place to
    // another, where a plain ring is one colour, and the art's own grey does not show through it.
    const ring: number[] = [];
    for (const radius of [64, 66]) {
      for (const angle of [0, 90, 180, 270]) {
        const at = screen(TOKEN_AT.x + radius * Math.cos((angle * Math.PI) / 180), TOKEN_AT.y + radius * Math.sin((angle * Math.PI) / 180));
        const [r = 0, g = 0, b = 0] = await pixel(at.x, at.y);
        expect([r, g, b]).not.toEqual([0x5b, 0x62, 0x70]);
        ring.push(r + g + b);
      }
    }
    expect(Math.max(...ring) - Math.min(...ring)).toBeGreaterThan(60);
  });

  it("draws the GM's ruler of a drag under way, with its distance, until the drag ends", async () => {
    const created = await createTable(test.gmOrigin);
    gm.connection.stop();
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const mapRef = await storeAsset(test, png(MAP_W, MAP_H, () => [40, 160, 60]), 'image/png');
    const send = (body: GmMessage, to: string): void => gm.connection.send(body, to);
    await page.close();
    page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';
    send({ t: 'scene', scene: { id: 's1', map: mapRef, lit: false } }, player);
    const measurement = { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 53 };
    send({ t: 'rules', scene: 's1', grid: { type: 'square', size: 70, offsetX: 0, offsetY: 0 }, snap: true, measurement, accent: '#7c8cff' } as GmMessage, player);
    const ui = { nameplate: false, downed: false, bars: [], conditions: [] };
    send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens: [{ id: TOKEN, x: 315, y: 315, size: 70, cells: 1, rotation: 0, art: null, name: 'Mira', ring: null, claim: 'taken', badge: null, ui }] }, player);
    send({ t: 'mine', scene: 's1', tokens: [TOKEN] }, player);
    await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });
    await page.waitForTimeout(300);

    const scale = Math.min(1200 / (MAP_W * 1.05), 800 / (MAP_H * 1.05));
    const screen = (x: number, y: number): { x: number; y: number } => ({ x: 600 + (x - MAP_W / 2) * scale, y: 400 + (y - MAP_H / 2) * scale });
    // Along the ruler, between the start and the token: map green before the drag, the ruler's ink during it.
    const along = screen(385, 315);
    const changed = async (): Promise<number> => {
      const shot = await page.screenshot({ clip: { x: along.x - 4, y: along.y - 4, width: 8, height: 8 } });
      return page.evaluate(async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        context?.drawImage(image, 0, 0);
        const pixels = context?.getImageData(0, 0, image.width, image.height).data ?? new Uint8ClampedArray();
        let off = 0;
        for (let index = 0; index < pixels.length; index += 4) if (Math.abs((pixels[index] ?? 0) - 40) + Math.abs((pixels[index + 1] ?? 0) - 160) + Math.abs((pixels[index + 2] ?? 0) - 60) > 60) off += 1;
        return off;
      }, shot.toString('base64'));
    };
    expect(await changed()).toBe(0);

    // The GM follows the player's drag and sends its ruler: from the cell it left to the one it would land on, four cells on.
    const live = (end: boolean): GmMessage => ({ t: 'live', scene: 's1', at: end ? 2_000 : 1_000, tokens: [{ id: TOKEN, x: 595, y: 315, ...(end ? { end: true as const } : { path: [[315, 315], [595, 315]] as [number, number][] }) }] });
    const settles = async (done: (off: number) => boolean): Promise<number> => {
      const deadline = Date.now() + 5_000;
      for (;;) {
        const off = await changed();
        if (done(off) || Date.now() > deadline) return off;
        await page.waitForTimeout(100);
      }
    };
    send(live(false), player);
    expect(await settles((off) => off > 0)).toBeGreaterThan(0);
    if (process.env.ATLAS_SHOTS) await page.screenshot({ path: path.join(process.env.ATLAS_SHOTS, 'drag-ruler.png') });

    send(live(true), player);
    expect(await settles((off) => off === 0)).toBe(0);
  });
});
