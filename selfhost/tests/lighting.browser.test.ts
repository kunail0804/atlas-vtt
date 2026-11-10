import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, storeAsset, until, type TestRelay } from './helpers.ts';
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

  /** One screenshot, read at several world points: every read of a frame is the same frame. */
  async function pixels(points: readonly (readonly [number, number])[]): Promise<number[][]> {
    const shot = await page.screenshot();
    const at = points.map(([x, y]) => screen(x, y));
    return page.evaluate(async ({ data, places }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0);
      return places.map((place) => [...(context?.getImageData(Math.round(place.x), Math.round(place.y), 1, 1).data ?? [])].slice(0, 3));
    }, { data: shot.toString('base64'), places: at });
  }

  const brightness = (rgb: number[]): number => Math.max(...rgb);

  /**
   * The brightness at `points` once `ready` holds for one frame, or in the last frame read after
   * `timeoutMs`: what a message changes reaches the screen after the page fetched and drew it, which
   * takes seconds on a loaded machine. Every check of a step then reads that one frame.
   */
  async function frameWhere(points: readonly (readonly [number, number])[], ready: (values: number[]) => boolean, timeoutMs = 15_000): Promise<number[]> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const values = (await pixels(points)).map(brightness);
      if (ready(values) || Date.now() > deadline) return values;
      await page.waitForTimeout(250);
    }
  }

  it('shows only what the token sees, and nothing before sight is known or while blind', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const mapBytes = png(MAP_W, MAP_H, () => [210, 210, 210]);
    const mapRef = await storeAsset(test, mapBytes, 'image/png');
    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';
    const send = (body: GmMessage): void => gm.connection.send(body, player);

    send({ t: 'scene', scene: { id: 'lit', map: mapRef, lit: true } });
    send({ t: 'lighting', scene: 'lit', cellSize: 70, unitDistance: 5, walls: [{ p: [500, 0, 500, 600] }], zones: [], senses: [] } as GmMessage);
    await page.waitForTimeout(1_200);
    // The map has loaded and the walls are known, but not yet what the tokens see: all of it dark.
    const unknown = (await pixels([[250, 300], [800, 300]])).map(brightness);
    expect(unknown[0]).toBeLessThan(20);
    expect(unknown[1]).toBeLessThan(20);

    const sight = (overrides: Record<string, unknown>): GmMessage => ({
      t: 'sight', scene: 'lit', lighting: { enabled: true, ambient: 0 }, lights: [], held: [],
      tokens: [{ id: EYE, x: 250, y: 300, size: 1, vision: { senses: [] }, light: TORCH }], ...overrides,
    } as GmMessage);
    send(sight({}));
    // In the torch's light on the token's side: the map shows. Behind the wall: dark.
    const seen = await frameWhere([[300, 300], [800, 300], [530, 300]], ([torchlit = 0]) => torchlit > 100);
    expect(seen[0]).toBeGreaterThan(100);
    expect(seen[1]).toBeLessThan(20);
    expect(seen[2]).toBeLessThan(20);

    // A door the players see gets its badge; a token they only sense, behind the wall, its outline.
    send({ t: 'doors', scene: 'lit', doors: [{ p: [500, 250, 500, 350], open: false }] } as GmMessage);
    send({ t: 'sensed', scene: 'lit', tokens: [{ x: 800, y: 300, size: 70 }] } as GmMessage);
    // The badge's white rim and glyph: the brightest of a line of samples across it.
    const across = Array.from({ length: 31 }, (_, index) => [504, 285 + index] as const);
    const around = Array.from({ length: 16 }, (_, step) => [800 + Math.cos((step / 16) * Math.PI * 2) * 34, 300 + Math.sin((step / 16) * Math.PI * 2) * 34] as const);
    const badgeAndRing = (values: number[]): boolean => Math.max(...values.slice(0, across.length)) > 150 && Math.max(...values.slice(across.length, across.length + around.length)) > 150;
    const marked = await frameWhere([...across, ...around, [900, 150]], badgeAndRing);
    expect(Math.max(...marked.slice(0, across.length))).toBeGreaterThan(150);
    expect(Math.max(...marked.slice(across.length, across.length + around.length))).toBeGreaterThan(150);
    // The map behind the wall is still dark beside the outline.
    expect(marked.at(-1)).toBeLessThan(20);

    // The explored memory the GM saved: the right half was seen before. It shows there, dimmed,
    // where no token sees now; what is not remembered stays black.
    const maskBytes = png(MAP_W, MAP_H, (x, y) => (x > 600 && y < 300 ? [255, 255, 255] : [0, 0, 0]));
    const maskRef = await storeAsset(test, maskBytes, 'image/png');
    send({ t: 'explored', scene: 'lit', mask: maskRef } as GmMessage);
    const [remembered = 0, lit = 0, forgotten = 0] = await frameWhere([[850, 120], [300, 300], [850, 500]], ([memory = 0]) => memory > 20);
    expect(remembered).toBeGreaterThan(20);
    expect(remembered).toBeLessThan(lit);
    expect(forgotten).toBeLessThan(20);

    // Full daylight, every vision token hidden: the GM says blind, and nothing shows.
    send(sight({ lighting: { enabled: true, ambient: 1 }, tokens: [], blind: true }));
    // Blind, only the remembered corner may show (Atlas shows memory wherever nothing is perceived now).
    // The torch's side was lit: waiting for it to go dark waits for the page to take the message.
    const blind = await frameWhere([[300, 300], [800, 450]], ([torchSide = 255]) => torchSide < 20);
    expect(blind[0]).toBeLessThan(20);
    expect(blind[1]).toBeLessThan(20);

    // Control: full daylight and no vision token at all is Atlas's "players see what the light shows".
    send(sight({ lighting: { enabled: true, ambient: 1 }, tokens: [] }));
    const [daylight = 0] = await frameWhere([[800, 300]], ([behindWall = 0]) => behindWall > 100);
    expect(daylight).toBeGreaterThan(100);
  }, 60_000);
});
