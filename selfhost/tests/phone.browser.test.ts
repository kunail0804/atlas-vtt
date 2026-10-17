import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetChunks, sha256Hex } from '../../src/app/online/gm/assetServe.ts';
import { DEFAULT_BOOK_SLOTS } from '../../src/app/online/protocol/bookSlots.ts';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';
import { png } from './png.ts';

// The page on a phone: every control on screen and clear of the others, and a finger moves the own token.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6';
const CONTROLS = ['.player-toolbar', '.atlas-bottom-toolbar-row__start > .atlas-vtt-toolbar', '.atlas-bottom-toolbar-row__end > .atlas-vtt-toolbar', '.initiative', '.widgets'];

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the player page on a phone', () => {
  let test: TestRelay;
  let browser: Browser;
  let page: Page;
  let gm: TestGm;

  beforeAll(async () => {
    test = await startTestRelay();
    browser = await chromium.launch({ executablePath: CHROMIUM });
    page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  });

  afterAll(async () => {
    gm?.connection.stop();
    await browser?.close();
    await stopTestRelay(test);
  });

  it('keeps every control on screen and apart, and moves the token by touch', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const send = (body: GmMessage, to: string): void => gm.connection.send(body, to);

    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.tap('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';

    const mapBytes = png(1000, 600, () => [40, 160, 60]);
    const mapHash = await sha256Hex(mapBytes as Uint8Array<ArrayBuffer>);
    send({ t: 'scene', scene: { id: 's1', map: { hash: mapHash, size: mapBytes.length, mime: 'image/png' }, lit: false } }, player);
    send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens: [{ id: TOKEN, x: 500, y: 300, size: 70, cells: 1, rotation: 0, art: null, name: 'Mira', ring: { colour: '#3366ff', size: 80 }, claim: 'taken', badge: null, ui: null }] }, player);
    send({ t: 'mine', scene: 's1', tokens: [TOKEN] }, player);
    for (const chunk of assetChunks(mapHash, mapBytes)) send(chunk, player);
    const combatant = (name: string, initiative: number, turn: boolean): Record<string, unknown> => ({ initiative, name, turn, sitsOut: false, art: null, ring: null, side: 'players', hp: null });
    send({ t: 'initiative', scene: 's1', list: { isActive: true, round: 1, bySides: false, firstSide: 'players', activeSide: null, combatants: [combatant('Mira', 18, true), combatant('Bran', 7, false), combatant('Gobelin', 5, false)] } } as GmMessage, player);
    send({ t: 'widgets', scene: 's1', bar: { scale: 1, widgets: [
      { kind: 'counter', label: 'Or', icon: 'coin', colour: null, value: 3 },
      { kind: 'clock', label: 'Rituel', icon: 'star', colour: null, value: 2, segments: 6, showCount: true },
      { kind: 'timer', label: 'Torche', icon: 'hourglass', colour: null, value: 600, since: 0 },
    ] } } as GmMessage, player);
    send({ t: 'book', book: { character: { name: 'Mira', art: null, ring: null, resources: [] }, worldMap: null, items: [], notes: [], pins: [], quests: [], purse: [], slots: DEFAULT_BOOK_SLOTS, equipped: [] } } as GmMessage, player);
    await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });
    for (const selector of CONTROLS) await page.waitForSelector(`${selector}:not([hidden])`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: '/tmp/atlas-phone.png' });

    const boxes = await page.evaluate((selectors) => selectors.map((selector) => {
      const box = document.querySelector(selector)?.getBoundingClientRect();
      return { selector, left: box?.left ?? 0, top: box?.top ?? 0, right: box?.right ?? 0, bottom: box?.bottom ?? 0 };
    }), CONTROLS);
    for (const box of boxes) {
      expect(box.left, box.selector).toBeGreaterThanOrEqual(0);
      expect(box.top, box.selector).toBeGreaterThanOrEqual(0);
      expect(box.right, box.selector).toBeLessThanOrEqual(390);
      expect(box.bottom, box.selector).toBeLessThanOrEqual(844);
    }
    for (const a of boxes) for (const b of boxes) {
      if (a === b) continue;
      const apart = a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
      expect(apart, `${a.selector} over ${b.selector}`).toBe(true);
    }

    // The book takes the whole width of a phone and closes again.
    await page.tap('.atlas-bottom-toolbar-row__end button');
    const book = await page.locator('.book').boundingBox();
    expect(book?.width).toBeGreaterThan(350);
    await page.tap('.book-close');
    expect(await page.locator('.book').isHidden()).toBe(true);

    // A finger on the own token drags it (the map is fitted, so its centre is the screen's centre).
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number): Promise<unknown> => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const centre = { x: 195, y: 422 };
    await touch('touchStart', centre.x, centre.y);
    for (let step = 1; step <= 8; step += 1) await touch('touchMove', centre.x + step * 10, centre.y);
    await touch('touchEnd', centre.x + 80, centre.y);
    await until(() => gm.messages.some((m) => (m.body as { t?: string }).t === 'move'), 'move sent', 5_000);
    const move = gm.messages.find((m) => (m.body as { t?: string }).t === 'move')?.body as { id: string; x: number };
    expect(move.id).toBe(TOKEN);
    expect(move.x).toBeGreaterThan(520);
  }, 60_000);
});
