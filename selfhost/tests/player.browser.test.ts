import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetChunks, sha256Hex } from '../../src/app/online/gm/assetServe.ts';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';
import { png } from './png.ts';

// The page as players get it: built (`npm run player:build`), served by a real relay, driven in
// Chromium, with the plugin's own connection code as the GM. Skipped where no Chromium is installed.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const MAP_W = 1000;
const MAP_H = 600;
const TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const TOKEN_AT = { x: 200, y: 300 };

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the player page in a browser', () => {
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

  it('joins, shows the map under the fog, moves the own token and chats', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');

    // A map: left half green, right half red. The GM's fog covers the right half.
    const mapBytes = png(MAP_W, MAP_H, (x) => (x < MAP_W / 2 ? [40, 160, 60] : [200, 40, 40]));
    const mapHash = await sha256Hex(mapBytes as Uint8Array<ArrayBuffer>);
    const send = (body: GmMessage, to: string): void => gm.connection.send(body, to);

    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';

    send({ t: 'scene', scene: { id: 's1', map: { hash: mapHash, size: mapBytes.length, mime: 'image/png' }, lit: false } }, player);
    send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens: [{ id: TOKEN, ...TOKEN_AT, size: 70, cells: 1, rotation: 0, art: null, name: 'Mira', ring: { colour: '#3366ff', size: 80 }, claim: 'taken', badge: null, ui: null }] }, player);
    send({ t: 'mine', scene: 's1', tokens: [TOKEN] }, player);
    send({ t: 'fog', scene: 's1', seq: 1, fog: [{ type: 'rectangle', erase: false, x: MAP_W / 2, y: 0, width: MAP_W / 2, height: MAP_H }] }, player);

    // The page asks for the map by hash; the GM answers with the plugin's own chunks.
    await until(() => gm.messages.some((m) => (m.body as { t?: string }).t === 'asset-request'), 'map requested', 10_000);
    for (const chunk of assetChunks(mapHash, mapBytes)) send(chunk, player);
    await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });

    // Where the map lies on screen: the page frames it with a 5 % margin, centred.
    const scale = Math.min(1200 / (MAP_W * 1.05), 800 / (MAP_H * 1.05));
    const screen = (x: number, y: number): { x: number; y: number } => ({ x: 600 + (x - MAP_W / 2) * scale, y: 400 + (y - MAP_H / 2) * scale });
    await page.waitForTimeout(300);
    const shot = await page.screenshot();
    const pixel = async (x: number, y: number): Promise<number[]> => page.evaluate(async ({ data, px, py }) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      context?.drawImage(image, 0, 0);
      return [...(context?.getImageData(Math.round(px), Math.round(py), 1, 1).data ?? [])];
    }, { data: shot.toString('base64'), px: x, py: y });
    const visible = await pixel(screen(100, 100).x, screen(100, 100).y);
    const fogged = await pixel(screen(900, 300).x, screen(900, 300).y);
    expect(visible[1]).toBeGreaterThan(120);
    expect(fogged.slice(0, 3)).toEqual([0, 0, 0]);

    // Drag the own token 100 px right: the GM gets drags, then the move.
    const from = screen(TOKEN_AT.x, TOKEN_AT.y);
    const to = screen(TOKEN_AT.x + 100, TOKEN_AT.y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await until(() => gm.messages.some((m) => (m.body as { t?: string }).t === 'move'), 'move sent', 5_000);
    const move = gm.messages.find((m) => (m.body as { t?: string }).t === 'move')?.body as { id: string; x: number; y: number };
    expect(move.id).toBe(TOKEN);
    expect(move.x).toBeGreaterThan(TOKEN_AT.x + 80);
    expect(gm.messages.some((m) => (m.body as { t?: string }).t === 'drag')).toBe(true);

    // Chat through the plugin's own log panel.
    await page.click('.chat-button');
    const field = page.locator('textarea').first();
    await field.fill('Bonjour la table');
    await field.press('Enter');
    await until(() => gm.messages.some((m) => (m.body as { t?: string; text?: string }).t === 'chat'), 'chat sent', 5_000);
    const chat = gm.messages.find((m) => (m.body as { t?: string }).t === 'chat')?.body as { text: string };
    expect(chat.text).toBe('Bonjour la table');
  });
});
