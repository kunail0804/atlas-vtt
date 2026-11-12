import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import type { LivePlace } from '../../src/app/online/protocol/live.ts';
import type { SharedToken } from '../../src/app/online/protocol/tokens.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, storeAsset, until, type TestRelay } from './helpers.ts';
import { png } from './png.ts';

// A player drags their own token under latency (issue #91). The GM's live lane echoes the drag about
// one round trip late, so places from the middle of the drag still reach the page after it let go,
// and the lane's end can overtake the token list that lands the drop. The scripted GM holds its
// echoes back and delivers them only after the drop: the token must stay where it was dropped.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const MAP_W = 1000;
const MAP_H = 600;
const OWN = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const OTHER = 'b1b2c3d4e5f6a1b2c3d4e5f6';
const START = { x: 200, y: 300 };
const OTHER_AT = { x: 150, y: 500 };

const token = (id: string, at: { x: number; y: number }, name: string, claim: SharedToken['claim']): SharedToken => ({
  id, ...at, size: 70, cells: 1, rotation: 0, art: null, name, ring: null, claim, badge: null, ui: null,
});

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('a token dropped under latency', () => {
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

  it('stays where it was dropped while late live places and the lane\'s end arrive', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const mapRef = await storeAsset(test, png(MAP_W, MAP_H, () => [40, 160, 60]), 'image/png');
    const send = (body: GmMessage, to: string): void => gm.connection.send(body, to);

    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';

    send({ t: 'scene', scene: { id: 's1', map: mapRef, lit: false } }, player);
    send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens: [token(OWN, START, 'Mira', 'taken'), token(OTHER, OTHER_AT, 'Gobelin', null)] }, player);
    send({ t: 'mine', scene: 's1', tokens: [OWN] }, player);
    await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });

    const scale = Math.min(1200 / (MAP_W * 1.05), 800 / (MAP_H * 1.05));
    const screen = (x: number, y: number): { x: number; y: number } => ({ x: 600 + (x - MAP_W / 2) * scale, y: 400 + (y - MAP_H / 2) * scale });
    // Whether a token's grey disc covers this world point, read from a new screenshot (the map is green there otherwise).
    const tokenAt = async (x: number, y: number): Promise<boolean> => {
      const shot = await page.screenshot();
      const at = screen(x, y);
      const rgb = await page.evaluate(async ({ data, px, py }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        context?.drawImage(image, 0, 0);
        return [...(context?.getImageData(Math.round(px), Math.round(py), 1, 1).data ?? [])];
      }, { data: shot.toString('base64'), px: at.x, py: at.y });
      return (rgb[1] ?? 0) < 130;
    };
    const eventually = async (check: () => Promise<boolean>, what: string): Promise<void> => {
      for (const deadline = Date.now() + 10_000; !(await check());) {
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
        await page.waitForTimeout(100);
      }
    };
    // The other token moves through the same lane: once the page shows it at a place, every live
    // message sent before that one has been taken too.
    const deliver = async (places: readonly LivePlace[], otherTo: { x: number; y: number }): Promise<void> => {
      send({ t: 'live', scene: 's1', at: Math.round(performance.now()), tokens: [...places, { id: OTHER, ...otherTo }] }, player);
      await eventually(() => tokenAt(otherTo.x, otherTo.y), 'the other token to move');
    };
    await eventually(() => tokenAt(START.x, START.y), 'the own token');

    // The drag: 400 px right in steps the page sends out as drags. The GM echoes none of them yet.
    const from = screen(START.x, START.y);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      const to = screen(START.x + step * 50, START.y);
      await page.mouse.move(to.x, to.y, { steps: 2 });
      await page.waitForTimeout(50);
    }
    await page.mouse.up();
    await until(() => gm.messages.some((m) => (m.body as { t?: string }).t === 'move'), 'move sent', 5_000);
    const drop = gm.messages.find((m) => (m.body as { t?: string }).t === 'move')?.body as { x: number; y: number };
    const drags = gm.messages.map((m) => m.body as { t?: string; x: number; y: number }).filter((body) => body.t === 'drag');
    expect(drop.x).toBeGreaterThan(START.x + 350);
    expect(drags.length).toBeGreaterThan(2);
    await eventually(() => tokenAt(drop.x, drop.y), 'the token under the pointer');

    // The echo of the middle of the drag arrives one round trip late, after the drop.
    const middle = drags[Math.floor(drags.length / 2)] ?? drags[0];
    if (middle === undefined) throw new Error('no drag sent');
    await deliver([{ id: OWN, x: middle.x, y: middle.y }], { x: 300, y: 500 });
    expect(await tokenAt(drop.x, drop.y)).toBe(true);
    expect(await tokenAt(middle.x, middle.y)).toBe(false);

    // The lane's end, with the place the GM landed the drop at, overtakes the token list.
    await deliver([{ id: OWN, x: drop.x, y: drop.y, end: true }], { x: 450, y: 500 });
    expect(await tokenAt(drop.x, drop.y)).toBe(true);
    expect(await tokenAt(START.x, START.y)).toBe(false);

    // The list lands the drop: nothing moves.
    send({ t: 'tokens', scene: 's1', seq: 2, cell: 70, snap: null, tokens: [token(OWN, { x: Math.round(drop.x), y: Math.round(drop.y) }, 'Mira', 'taken'), token(OTHER, { x: 450, y: 500 }, 'Gobelin', null)] }, player);
    await page.waitForTimeout(300);
    expect(await tokenAt(drop.x, drop.y)).toBe(true);
    expect(await tokenAt(START.x, START.y)).toBe(false);
  }, 60_000);
});
