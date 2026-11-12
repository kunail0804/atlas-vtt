import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import type { LivePlace } from '../../src/app/online/protocol/live.ts';
import type { SharedToken } from '../../src/app/online/protocol/tokens.ts';
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
const OTHER = 'b1b2c3d4e5f6a1b2c3d4e5f6';
// Where the map lies on screen: the page frames it with a 5 % margin, centred.
const SCALE = Math.min(1200 / (MAP_W * 1.05), 800 / (MAP_H * 1.05));
const screen = (x: number, y: number): { x: number; y: number } => ({ x: 600 + (x - MAP_W / 2) * SCALE, y: 400 + (y - MAP_H / 2) * SCALE });
const plainToken = (id: string, at: { x: number; y: number }, name: string, claim: SharedToken['claim']): SharedToken => ({
  id, ...at, size: 70, cells: 1, rotation: 0, art: null, name, ring: null, claim, badge: null, ui: null,
});

/** The colour on screen at a world point, from a new screenshot of that one pixel. */
async function colourAt(page: Page, x: number, y: number): Promise<number[]> {
  const at = screen(x, y);
  const shot = await page.screenshot({ clip: { x: Math.round(at.x), y: Math.round(at.y), width: 1, height: 1 } });
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = new OffscreenCanvas(1, 1);
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    return [...(canvas.getContext('2d')?.getImageData(0, 0, 1, 1).data ?? [])];
  }, shot.toString('base64'));
}

/** How many pixels of an 8 × 8 square around a world point are not the green map: a ruler's ink, a token. */
async function offGreen(page: Page, x: number, y: number): Promise<number> {
  const at = screen(x, y);
  const shot = await page.screenshot({ clip: { x: at.x - 4, y: at.y - 4, width: 8, height: 8 } });
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
}

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

  // Whether a token's grey disc covers this world point (the map is green there otherwise).
  const tokenAt = async (x: number, y: number): Promise<boolean> => ((await colourAt(page, x, y))[1] ?? 0) < 130;
  const eventually = async (check: () => Promise<boolean>, what: string): Promise<void> => {
    for (const deadline = Date.now() + 10_000; !(await check());) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await page.waitForTimeout(100);
    }
  };
  /** A live message from the GM; the other token moves in it, and once the page shows it there, the message was taken. */
  const deliverLive = async (send: (body: GmMessage, to: string) => void, player: string, places: readonly LivePlace[], otherTo: { x: number; y: number }): Promise<void> => {
    send({ t: 'live', scene: 's1', at: Math.round(performance.now()), tokens: [...places, { id: OTHER, ...otherTo }] }, player);
    await eventually(() => tokenAt(otherTo.x, otherTo.y), 'the other token to move');
  };

  /** A new table, and this player seated at it on a fresh page, shown scene `s1` over a green map. */
  const seatOnGreenMap = async (): Promise<{ send: (body: GmMessage, to: string) => void; player: string }> => {
    const created = await createTable(test.gmOrigin);
    gm?.connection.stop();
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
    return { send, player };
  };

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

    const shot = await page.screenshot();
    if (process.env.ATLAS_SHOTS) await page.screenshot({ path: path.join(process.env.ATLAS_SHOTS, 'own-token.png'), clip: { x: screen(200, 200).x, y: screen(200, 200).y, width: 200 * SCALE, height: 220 * SCALE } });
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
    const { send, player } = await seatOnGreenMap();
    const measurement = { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 53 };
    send({ t: 'rules', scene: 's1', grid: { type: 'square', size: 70, offsetX: 0, offsetY: 0 }, snap: true, measurement, accent: '#7c8cff' } as GmMessage, player);
    const ui = { nameplate: false, downed: false, bars: [], conditions: [] };
    send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens: [{ id: TOKEN, x: 315, y: 315, size: 70, cells: 1, rotation: 0, art: null, name: 'Mira', ring: null, claim: 'taken', badge: null, ui }] }, player);
    send({ t: 'mine', scene: 's1', tokens: [TOKEN] }, player);
    await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });
    await page.waitForTimeout(300);

    // Along the ruler, between the start and the token: map green before the drag, the ruler's ink during it.
    const changed = (): Promise<number> => offGreen(page, 385, 315);
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

  // Issue #91. The GM echoes a player's drag about one round trip late, so places from the middle of the
  // drag still reach the page after it let go, and the lane's end can overtake the token list that
  // lands the drop. The GM here holds its echoes back and delivers them after the drop.
  it('stays where it was dropped while late live places and the lane\'s end arrive', async () => {
    const start = { x: 200, y: 300 };
    const { send, player } = await seatOnGreenMap();
    send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens: [plainToken(TOKEN, start, 'Mira', 'taken'), plainToken(OTHER, { x: 150, y: 500 }, 'Gobelin', null)] }, player);
    send({ t: 'mine', scene: 's1', tokens: [TOKEN] }, player);
    await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });

    const deliver = (places: readonly LivePlace[], otherTo: { x: number; y: number }): Promise<void> => deliverLive(send, player, places, otherTo);
    await eventually(() => tokenAt(start.x, start.y), 'the own token');

    // The drag: 400 px right in steps the page sends out as drags. The GM echoes none of them yet.
    const from = screen(start.x, start.y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      const to = screen(start.x + step * 50, start.y);
      await page.mouse.move(to.x, to.y, { steps: 2 });
      await page.waitForTimeout(50);
    }
    await page.mouse.up();
    await until(() => gm.messages.some((m) => (m.body as { t?: string }).t === 'move'), 'move sent', 5_000);
    const drop = gm.messages.find((m) => (m.body as { t?: string }).t === 'move')?.body as { x: number; y: number };
    const drags = gm.messages.map((m) => m.body as { t?: string; x: number; y: number }).filter((body) => body.t === 'drag');
    expect(drop.x).toBeGreaterThan(start.x + 350);
    const middle = drags[Math.floor(drags.length / 2)];
    if (drags.length < 3 || middle === undefined) throw new Error('too few drags sent');
    await eventually(() => tokenAt(drop.x, drop.y), 'the token under the pointer');

    // The echo of the middle of the drag arrives after the drop.
    await deliver([{ id: TOKEN, x: middle.x, y: middle.y }], { x: 300, y: 500 });
    expect(await tokenAt(drop.x, drop.y)).toBe(true);
    expect(await tokenAt(middle.x, middle.y)).toBe(false);

    // The lane's end, with the place the GM landed the drop at, overtakes the token list.
    await deliver([{ id: TOKEN, x: drop.x, y: drop.y, end: true }], { x: 450, y: 500 });
    expect(await tokenAt(drop.x, drop.y)).toBe(true);
    expect(await tokenAt(start.x, start.y)).toBe(false);

    // The list lands the drop: nothing moves.
    const landed = { x: Math.round(drop.x), y: Math.round(drop.y) };
    send({ t: 'tokens', scene: 's1', seq: 2, cell: 70, snap: null, tokens: [plainToken(TOKEN, landed, 'Mira', 'taken'), plainToken(OTHER, { x: 450, y: 500 }, 'Gobelin', null)] }, player);
    await page.waitForTimeout(300);
    expect(await tokenAt(drop.x, drop.y)).toBe(true);
    expect(await tokenAt(start.x, start.y)).toBe(false);
  }, 60_000);

  // Issue #111. The ruler of the player's own drag is drawn by the page from where the token was taken to
  // where it is, without waiting for the GM, and goes when the token is put down: the GM's echoes of the
  // drag, held back here and delivered after the drop, never bring it back.
  it('draws the ruler of its own drag at once and drops it with the token, whatever the GM echoes late', async () => {
    const start = { x: 315, y: 315 };
    const { send, player } = await seatOnGreenMap();
    const measurement = { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 53 };
    send({ t: 'rules', scene: 's1', grid: { type: 'square', size: 70, offsetX: 0, offsetY: 0 }, snap: true, measurement, accent: '#7c8cff' } as GmMessage, player);
    send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens: [plainToken(TOKEN, start, 'Mira', 'taken'), plainToken(OTHER, { x: 150, y: 500 }, 'Gobelin', null)] }, player);
    send({ t: 'mine', scene: 's1', tokens: [TOKEN] }, player);
    await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });
    await eventually(() => tokenAt(start.x, start.y), 'the own token');
    const inked = (x: number, y: number): Promise<boolean> => offGreen(page, x, y).then((off) => off > 0);
    const clear = (x: number, y: number): Promise<boolean> => offGreen(page, x, y).then((off) => off === 0);
    expect(await clear(385, 315)).toBe(true);

    // Two cells to the right: the ruler runs from the cell the token left. The GM answers nothing.
    const from = screen(start.x, start.y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const near = screen(start.x + 140, start.y);
    await page.mouse.move(near.x, near.y, { steps: 4 });
    await eventually(() => inked(385, 315), 'the ruler under way');
    // Four cells on, it follows the token.
    const far = screen(start.x + 420, start.y);
    await page.mouse.move(far.x, far.y, { steps: 6 });
    await eventually(() => inked(630, 315), 'the ruler to follow the token');
    expect(await inked(start.x, start.y)).toBe(true);
    if (process.env.ATLAS_SHOTS) await page.screenshot({ path: path.join(process.env.ATLAS_SHOTS, 'own-drag-ruler.png') });

    await page.mouse.up();
    await until(() => gm.messages.some((m) => (m.body as { t?: string }).t === 'move'), 'move sent', 5_000);
    const drop = gm.messages.find((m) => (m.body as { t?: string }).t === 'move')?.body as { x: number; y: number };
    // Gone with the drop: one look, well before a ruler nobody tells of would go by itself (`DRAG_SILENCE_MS`).
    expect(await clear(630, 315)).toBe(true);
    expect(await clear(385, 315)).toBe(true);

    // The GM's echo of the middle of the drag, with its ruler, arrives after the drop: no ruler comes back.
    await deliverLive(send, player, [{ id: TOKEN, x: 525, y: 315, path: [[315, 315], [525, 315]] }], { x: 300, y: 500 });
    await page.waitForTimeout(100);
    expect(await clear(385, 315)).toBe(true);
    // The lane's end, then the list that lands the drop.
    await deliverLive(send, player, [{ id: TOKEN, x: drop.x, y: drop.y, end: true }], { x: 450, y: 500 });
    send({ t: 'tokens', scene: 's1', seq: 2, cell: 70, snap: null, tokens: [plainToken(TOKEN, { x: Math.round(drop.x), y: Math.round(drop.y) }, 'Mira', 'taken'), plainToken(OTHER, { x: 450, y: 500 }, 'Gobelin', null)] }, player);
    await page.waitForTimeout(300);
    expect(await clear(385, 315)).toBe(true);

    // A token someone else drags keeps the GM's ruler.
    send({ t: 'live', scene: 's1', at: Math.round(performance.now()), tokens: [{ id: OTHER, x: 590, y: 500, path: [[450, 500], [590, 500]] }] }, player);
    await eventually(() => inked(505, 500), 'the GM\'s ruler of the other token');
  }, 60_000);
});
