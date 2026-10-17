import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetChunks, sha256Hex } from '../../src/app/online/gm/assetServe.ts';
import { DEFAULT_BOOK_SLOTS } from '../../src/app/online/protocol/bookSlots.ts';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';
import { png } from './png.ts';

// The player's toolbar on the built page: the GM's tool groups and dice tray, the log and the book on
// either side, and what each tool sends. The GM is the plugin's own connection code.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const SHOTS = process.env.ATLAS_SHOTS;
const MAP_W = 1000;
const MAP_H = 600;

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the player toolbar in a browser', () => {
  let test: TestRelay;
  let browser: Browser;
  let page: Page;
  let gm: TestGm;

  beforeAll(async () => {
    test = await startTestRelay();
    browser = await chromium.launch({ executablePath: CHROMIUM });
    page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.on('pageerror', (error) => console.log('PAGEERROR', String(error)));
    page.on('console', (message) => { if (message.type() === 'error') console.log('CONSOLE', message.text()); });
  });

  afterAll(async () => {
    gm?.connection.stop();
    await browser?.close();
    await stopTestRelay(test);
  });

  const shot = async (name: string): Promise<void> => {
    if (SHOTS !== undefined) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  };

  it('offers the GM\'s tools and sends what they make', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const send = (body: GmMessage, to: string): void => gm.connection.send(body, to);
    const sentOf = (type: string): Record<string, unknown>[] => gm.messages.map((m) => m.body as Record<string, unknown>).filter((body) => body.t === type);

    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Mira');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';

    const mapBytes = png(MAP_W, MAP_H, () => [40, 120, 60]);
    const mapHash = await sha256Hex(mapBytes as Uint8Array<ArrayBuffer>);
    send({ t: 'scene', scene: { id: 's1', map: { hash: mapHash, size: mapBytes.length, mime: 'image/png' }, lit: false } }, player);
    send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens: [] }, player);
    for (const chunk of assetChunks(mapHash, mapBytes)) send(chunk, player);
    const measurement = { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 53 };
    send({ t: 'rules', scene: 's1', grid: { type: 'square', size: 70, offsetX: 0, offsetY: 0 }, snap: true, measurement, accent: '#7c8cff', advantage: ['advantage', 'disadvantage'] } as GmMessage, player);
    send({ t: 'book', book: { character: null, worldMap: null, items: [], notes: [], pins: [], quests: [], purse: [], slots: DEFAULT_BOOK_SLOTS, equipped: [] } } as GmMessage, player);
    await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });
    await page.waitForSelector('.player-toolbar');
    await page.waitForTimeout(300);
    await shot('bar');

    const chevrons = page.locator('.player-toolbar .atlas-tool-group .atlas-dropdown-trigger');
    for (const [index, name] of ['move', 'draw', 'text', 'measure'].entries()) {
      await chevrons.nth(index).click();
      await page.waitForTimeout(200);
      await shot(`menu-${name}`);
      await page.keyboard.press('Escape');
    }
    await page.click('.player-dice button');
    await page.waitForSelector('.atlas-dice-tray');
    await page.waitForTimeout(400);
    await shot('dice');
    await page.keyboard.press('Escape');

    // Chat and book stand open together.
    await page.click('.atlas-bottom-toolbar-row__start button');
    await page.waitForSelector('.atlas-online-log');
    await page.click('.atlas-bottom-toolbar-row__end button');
    await page.waitForSelector('.book:not([hidden])');
    expect(await page.locator('.atlas-online-log').count()).toBe(1);
    await shot('chat-and-book');
    // A press in the toolbar and in the book leaves the log open.
    await page.click('.book-tab[data-tab="notes"]');
    await page.locator('.player-toolbar .atlas-tool-group .atlas-dropdown-trigger').first().click();
    await page.locator('.player-toolbar .atlas-tool-group .atlas-dropdown-trigger').first().click();
    expect(await page.locator('.atlas-online-log').count()).toBe(1);
    await page.click('.atlas-bottom-toolbar-row__start button');
    await page.click('.atlas-bottom-toolbar-row__end button');

    // The GM keeps what players make and sends it to all, as the plugin's PlayerAnnotations does.
    const drawings: Record<string, unknown>[] = [];
    const texts: Record<string, unknown>[] = [];
    let echoed = 0;
    const echo = setInterval(() => {
      const fresh = gm.messages.slice(echoed);
      echoed = gm.messages.length;
      let changed = false;
      for (const { from, body } of fresh) {
        const message = body as Record<string, unknown>;
        if (message.t === 'draw') {
          drawings.push({ ...(message.drawing as object), opacity: 1, id: message.id, by: from });
          changed = true;
        } else if (message.t === 'place-text') {
          const text = message.text as Record<string, unknown>;
          texts.push({ ...text, fontFamily: 'Arial', background: '#000000', padding: 8, radius: 4, opacity: 0.7, align: 'center', italic: false, rotation: 0, scale: 1, id: message.id, by: from });
          changed = true;
        } else if (message.t === 'erase') {
          const ids = new Set(message.ids as string[]);
          for (const list of [drawings, texts]) for (let index = list.length - 1; index >= 0; index -= 1) if (ids.has(list[index]?.id as string)) list.splice(index, 1);
          changed = true;
        }
      }
      if (changed) send({ t: 'annotations', scene: 's1', drawings, texts } as GmMessage, player);
    }, 30);

    try {
      const scale = Math.min(1400 / (MAP_W * 1.05), 900 / (MAP_H * 1.05));
      const screen = (x: number, y: number): { x: number; y: number } => ({ x: 700 + (x - MAP_W / 2) * scale, y: 450 + (y - MAP_H / 2) * scale });
      const drag = async (from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> => {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 20 });
        await page.mouse.up();
      };

      // The pen: a stroke goes to the GM in world pixels, white and 4 wide by default.
      await page.keyboard.press('b');
      await drag(screen(200, 300), screen(600, 300));
      await until(() => sentOf('draw').length === 1, 'stroke sent', 5_000);
      const stroke = sentOf('draw')[0] as { id: string; drawing: { type: string; points: number[]; colour: string; width: number } };
      expect(stroke.drawing).toMatchObject({ type: 'pen', colour: '#ffffff', width: 4 });
      expect(stroke.drawing.points[0]).toBeCloseTo(200, -1);
      expect(stroke.drawing.points.at(-2)).toBeCloseTo(600, -1);
      expect(stroke.id).toMatch(/^[0-9a-f]{24}$/);

      // The icon stamp, from the draw menu's icon grid.
      await page.locator('.player-toolbar .atlas-tool-group .atlas-dropdown-trigger').nth(1).click();
      await page.locator('.atlas-icon-grid__item').nth(5).click();
      await page.mouse.click(screen(800, 150).x, screen(800, 150).y);
      await until(() => sentOf('draw').length === 2, 'stamp sent', 5_000);
      expect((sentOf('draw')[1] as { drawing: unknown }).drawing).toMatchObject({ type: 'icon', icon: 'skull', width: 70 });

      // A text, typed where the player clicked.
      await page.keyboard.press('t');
      await page.mouse.click(screen(500, 450).x, screen(500, 450).y);
      await page.fill('.player-text-input input', 'Porte piégée');
      await page.keyboard.press('Enter');
      await until(() => sentOf('place-text').length === 1, 'text sent', 5_000);
      expect((sentOf('place-text')[0] as { text: unknown }).text).toMatchObject({ text: 'Porte piégée', fontSize: 24, colour: '#ffffff', bold: false });
      await page.waitForFunction(() => document.querySelector('.player-text-input') === null);

      // The eraser rubs out the middle of the stroke: the stroke goes, its two ends come back as strokes of their own.
      await until(() => drawings.length === 2, 'drawings echoed', 5_000);
      await page.waitForTimeout(200);
      await shot('drawn');
      await page.locator('.player-toolbar .atlas-tool-group .atlas-dropdown-trigger').nth(1).click();
      await page.click('.atlas-dropdown-content >> text=Drawing Eraser');
      await drag(screen(400, 260), screen(400, 340));
      await until(() => sentOf('erase').length >= 1, 'erase sent', 5_000);
      expect(sentOf('erase').flatMap((message) => message.ids as string[])).toContain(stroke.id);
      await until(() => drawings.filter((drawing) => drawing.type === 'pen').length === 2, 'two ends kept', 5_000);
      const ends = drawings.filter((drawing) => drawing.type === 'pen').map((drawing) => drawing.points as number[]);
      expect(Math.min(...ends.map((points) => Math.min(...points.filter((_, index) => index % 2 === 0))))).toBeLessThan(250);
      expect(Math.max(...ends.map((points) => Math.max(...points.filter((_, index) => index % 2 === 0))))).toBeGreaterThan(550);
      expect(ends.every((points) => points.filter((_, index) => index % 2 === 0).every((x) => Math.abs(x - 400) > 15))).toBe(true);

      // "Delete all": everything the player made goes.
      await page.locator('.player-toolbar .atlas-tool-group .atlas-dropdown-trigger').nth(1).click();
      await page.click('text=Effacer tous mes dessins');
      await until(() => drawings.length === 0 && texts.length === 0, 'all erased', 5_000);
    } finally {
      clearInterval(echo);
    }

    // A circle that stays: the measure menu's shape and "Persist Measurements".
    await page.locator('.player-toolbar .atlas-tool-group .atlas-dropdown-trigger').nth(3).click();
    await page.click('.atlas-dropdown-content >> text=Circle/Sphere');
    await page.locator('.player-toolbar .atlas-tool-group .atlas-dropdown-trigger').nth(3).click();
    await page.click('.atlas-dropdown-content [role="switch"]');
    await page.locator('.player-toolbar .atlas-tool-group .atlas-dropdown-trigger').nth(3).click();
    const scale = Math.min(1400 / (MAP_W * 1.05), 900 / (MAP_H * 1.05));
    await page.mouse.move(700, 450);
    await page.mouse.down();
    await page.mouse.move(700 + 140 * scale, 450, { steps: 6 });
    await page.mouse.up();
    await until(() => sentOf('measure').some((message) => (message.kept as unknown[]).length === 1), 'kept circle sent', 5_000);
    const kept = sentOf('measure').at(-1) as { kept: { shape: string }[]; live: unknown };
    expect(kept.live).toBeNull();
    expect(kept.kept[0]?.shape).toBe('circle');

    // The laser in the colour the player chose.
    await page.locator('.player-toolbar .atlas-tool-group .atlas-dropdown-trigger').nth(0).click();
    await page.locator('.atlas-swatch-grid .atlas-swatch').nth(5).click();
    await page.click('.atlas-dropdown-content >> text=Laser Pointer');
    await page.mouse.move(600, 400);
    await page.mouse.down();
    await page.mouse.move(700, 420, { steps: 6 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await until(() => sentOf('laser').some((message) => message.on === true), 'laser sent', 5_000);
    expect(sentOf('laser').find((message) => message.on === true)?.color).toBe('#3d6bff');

    // The dice tray: a d20 with advantage goes to the GM, who rolls it by the collection's dice set.
    await page.keyboard.press('r');
    await page.waitForSelector('.atlas-dice-tray');
    await page.locator('.atlas-dice-tray__face').nth(5).click();
    await page.locator('.atlas-dice-tray .atlas-segmented__option', { hasText: /^Advantage$/ }).click();
    await page.click('.atlas-dice-tray__roll');
    await until(() => sentOf('roll').length === 1, 'roll sent', 5_000);
    expect(sentOf('roll')[0]).toEqual({ t: 'roll', scene: 's1', formula: '1d20', token: null, advantage: 'advantage' });
    expect(await page.locator('.atlas-dice-tray').count()).toBe(0);
  }, 60_000);
});
