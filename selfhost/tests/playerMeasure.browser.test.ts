import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MarkShare, type PlayerMarks } from '../../src/app/online/gm/MarkShare.ts';
import { PLAYER_COLOURS, parsePlayerMark, playerTone, type GmMessage, type PlayerMeasure } from '../../src/app/online/protocol/index.ts';
import { TestGm, createTable, nodeTimers, startTestRelay, stopTestRelay, storeAsset, until, type TestRelay } from './helpers.ts';
import { png } from './png.ts';

// Two player pages as players get them, a real relay, and the plugin's own `MarkShare` as the GM's
// side of the marks (#181). Skipped where no Chromium is installed.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const MAP_W = 1000;
const MAP_H = 600;
/** The GM's accent: the colour pages told measurements in before, and which a player's must not take. */
const ACCENT = '#8a5cf5';

type Rgb = readonly [number, number, number];
const rgbOf = (hex: string): Rgb => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];
const near = (a: readonly number[], b: Rgb): boolean => a.every((value, index) => index > 2 || Math.abs(value - (b[index] ?? 0)) <= 24);

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('a player\'s measurement at the table', () => {
  let test: TestRelay;
  let browser: Browser;
  let gm: TestGm;
  let share: MarkShare;

  beforeAll(async () => {
    test = await startTestRelay();
    browser = await chromium.launch({ executablePath: CHROMIUM });
  });

  afterAll(async () => {
    share?.stop();
    gm?.connection.stop();
    await browser?.close();
    await stopTestRelay(test);
  });

  it('is seen by the GM and by another player, in the colour of the player who draws it', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const shown: PlayerMarks[] = [];
    share = new MarkShare({ ...nodeTimers, send: (body: GmMessage, to?: string) => gm.connection.send(body, to), showPlayerMarks: (marks) => void shown.push(marks) }, () => ({ width: MAP_W, height: MAP_H }));
    share.setScene('s1');
    gm.onMessage = (from, body) => {
      const mark = typeof body === 'object' && body !== null ? parsePlayerMark(body as Record<string, unknown>) : null;
      if (mark?.t === 'measure') share.receive(from, mark);
    };

    const mapRef = await storeAsset(test, png(MAP_W, MAP_H, () => [40, 40, 40]), 'image/png');
    const join = async (name: string): Promise<{ page: Page; id: string }> => {
      const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
      const seated = gm.joined.length;
      await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
      await page.fill('.join-input >> nth=0', name);
      await page.click('.join-button');
      await until(() => gm.joined.length === seated + 1, `${name} seated`, 10_000);
      const id = gm.joined[seated]?.id ?? '';
      const measurement = { mode: 'metric', unitType: 'meters', unitDistance: 1.5, ruleDistance: 1.5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 53 } as const;
      gm.connection.send({ t: 'scene', scene: { id: 's1', map: mapRef, lit: false } }, id);
      gm.connection.send({ t: 'tokens', scene: 's1', seq: 1, cell: 70, snap: null, tokens: [] }, id);
      gm.connection.send({ t: 'rules', scene: 's1', grid: { type: 'square', size: 70, offsetX: 0, offsetY: 0 }, snap: true, measurement, accent: ACCENT } as GmMessage, id);
      await page.waitForFunction(() => (document.querySelector('.status') as HTMLElement | null)?.hidden === true, null, { timeout: 10_000 });
      return { page, id };
    };
    const testeur = await join('Testeur');
    const invitee = await join('Invitee');
    // Testeur's colour at the table, as the players' page has it (`page.css`).
    const variable = PLAYER_COLOURS[playerTone(testeur.id)] ?? '';
    const colour = (await invitee.page.evaluate((name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), variable)).toLowerCase();
    expect(colour).toMatch(/^#[0-9a-f]{6}$/);

    // Testeur draws a ruler across the map and holds it.
    const scale = Math.min(1200 / (MAP_W * 1.05), 800 / (MAP_H * 1.05));
    const screen = (x: number, y: number): { x: number; y: number } => ({ x: 600 + (x - MAP_W / 2) * scale, y: 400 + (y - MAP_H / 2) * scale });
    await testeur.page.keyboard.press('m');
    const start = screen(200, 300);
    await testeur.page.mouse.move(start.x, start.y);
    await testeur.page.mouse.down();
    await testeur.page.mouse.move(screen(800, 300).x, start.y, { steps: 8 });

    // The GM sees it while it is drawn, and it goes out in Testeur's colour, not the GM's accent.
    await until(() => shown.some((marks) => marks.measures.some((measure) => measure.who === testeur.id && measure.live !== null)), 'GM shown the measurement', 5_000);
    const told = gm.messages.map((message) => message.body as PlayerMeasure).filter((body) => body.t === 'measure' && body.live !== null).at(-1);
    expect(told?.color).toBe(colour);
    expect(told?.color).not.toBe(ACCENT);

    // Invitee draws it, in Testeur's colour: some pixel along the line has it.
    const wanted = rgbOf(colour);
    let found = false;
    for (const deadline = Date.now() + 15_000; !found && Date.now() < deadline;) {
      const shot = await invitee.page.screenshot();
      const centre = screen(500, 300);
      found = await invitee.page.evaluate(async ({ data, x, y, want }) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        context?.drawImage(image, 0, 0);
        const strip = context?.getImageData(Math.round(x) - 40, Math.round(y) - 8, 80, 16).data ?? new Uint8ClampedArray();
        for (let index = 0; index < strip.length; index += 4) {
          if (Math.abs((strip[index] ?? 0) - want[0]) <= 24 && Math.abs((strip[index + 1] ?? 0) - want[1]) <= 24 && Math.abs((strip[index + 2] ?? 0) - want[2]) <= 24) return true;
        }
        return false;
      }, { data: shot.toString('base64'), x: centre.x, y: centre.y, want: [...wanted] });
      if (!found) await invitee.page.waitForTimeout(250);
    }
    expect(found).toBe(true);
    expect(near(rgbOf(ACCENT), wanted)).toBe(false);
    await testeur.page.mouse.up();
  });
});
