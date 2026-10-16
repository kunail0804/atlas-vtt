import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetChunks, sha256Hex } from '../../src/app/online/gm/assetServe.ts';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';
import { png } from './png.ts';

// A lit scene must never show players what no token sees. The plugin's own engine lights it on the
// page; these checks read the screen: dark behind a wall, dark before sight is known, dark while blind.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const MAP_W = 1000;
const MAP_H = 600;
const EYE = 'f1f2f3f4f5f6f7f8f9f0fafb';
const TORCH = { bright: 20, dim: 40, color: '#ffffff', intensity: 1, animation: 'none' };

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('dynamic lighting on the player page', () => {
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

  const scale = Math.min(1200 / (MAP_W * 1.05), 800 / (MAP_H * 1.05));
  const screen = (x: number, y: number): { x: number; y: number } => ({ x: 600 + (x - MAP_W / 2) * scale, y: 400 + (y - MAP_H / 2) * scale });

  async function pixel(x: number, y: number): Promise<number[]> {
    const shot = await page.screenshot();
    const at = screen(x, y);
    return page.evaluate(async ({ data, px, py }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0);
      return [...(context?.getImageData(Math.round(px), Math.round(py), 1, 1).data ?? [])].slice(0, 3);
    }, { data: shot.toString('base64'), px: at.x, py: at.y });
  }

  const brightness = (rgb: number[]): number => Math.max(...rgb);

  it('shows only what the token sees, and nothing before sight is known or while blind', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const mapBytes = png(MAP_W, MAP_H, () => [210, 210, 210]);
    const mapHash = await sha256Hex(mapBytes as Uint8Array<ArrayBuffer>);
    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';
    const send = (body: GmMessage): void => gm.connection.send(body, player);

    send({ t: 'scene', scene: { id: 'lit', map: { hash: mapHash, size: mapBytes.length, mime: 'image/png' }, lit: true } });
    await until(() => gm.messages.some((m) => (m.body as { t?: string }).t === 'asset-request'), 'map requested', 10_000);
    for (const chunk of assetChunks(mapHash, mapBytes)) send(chunk);
    send({ t: 'lighting', scene: 'lit', cellSize: 70, unitDistance: 5, walls: [{ p: [500, 0, 500, 600] }], zones: [], senses: [] } as GmMessage);
    await page.waitForTimeout(1_200);
    // The map has loaded and the walls are known, but not yet what the tokens see: all of it dark.
    expect(brightness(await pixel(250, 300))).toBeLessThan(20);
    expect(brightness(await pixel(800, 300))).toBeLessThan(20);

    const sight = (overrides: Record<string, unknown>): GmMessage => ({
      t: 'sight', scene: 'lit', lighting: { enabled: true, ambient: 0 }, lights: [], held: [],
      tokens: [{ id: EYE, x: 250, y: 300, size: 1, vision: { senses: [] }, light: TORCH }], ...overrides,
    } as GmMessage);
    send(sight({}));
    await page.waitForTimeout(1_500);
    // In the torch's light on the token's side: the map shows. Behind the wall: dark.
    expect(brightness(await pixel(300, 300))).toBeGreaterThan(100);
    expect(brightness(await pixel(800, 300))).toBeLessThan(20);
    expect(brightness(await pixel(530, 300))).toBeLessThan(20);

    // Full daylight, every vision token hidden: the GM says blind, and nothing shows.
    send(sight({ lighting: { enabled: true, ambient: 1 }, tokens: [], blind: true }));
    await page.waitForTimeout(1_500);
    expect(brightness(await pixel(300, 300))).toBeLessThan(20);
    expect(brightness(await pixel(800, 300))).toBeLessThan(20);

    // Control: full daylight and no vision token at all is Atlas's "players see what the light shows".
    send(sight({ lighting: { enabled: true, ambient: 1 }, tokens: [] }));
    await page.waitForTimeout(1_500);
    expect(brightness(await pixel(800, 300))).toBeGreaterThan(100);
  }, 60_000);
});
