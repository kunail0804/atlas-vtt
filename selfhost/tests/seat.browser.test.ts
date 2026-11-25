import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BATCH_MS } from '../../src/app/online/gm/sendQueue.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';

// The seat a browser keeps, as players live it: a reload takes it back without a word typed, and a
// page whose seat the GM gave to the player's other browser says so, and does not take it back.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the seat a browser keeps', () => {
  let test: TestRelay;
  let browser: Browser;
  let gm: TestGm;

  beforeAll(async () => {
    test = await startTestRelay();
    browser = await chromium.launch({ executablePath: CHROMIUM });
  });

  afterAll(async () => {
    gm?.connection.stop();
    await browser?.close();
    await stopTestRelay(test);
  });

  /** A page of its own browser (a profile of its own: its own local storage). */
  async function browserPage(): Promise<Page> {
    const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
    return context.newPage();
  }

  const joinForm = (page: Page): Promise<boolean> => page.locator('.join').isVisible();

  it('is taken back on a reload, and a page whose seat moved to another browser says so and asks again', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const url = `http://127.0.0.1:${test.relay.publicPort}/#${created.code}`;

    const first = await browserPage();
    await first.goto(url);
    await first.fill('.join-input >> nth=0', 'Mira');
    await first.click('.join-button');
    await until(() => gm.joined.length === 1, 'Mira seated', 10_000);
    const id = gm.joined[0]?.id ?? '';
    gm.connection.setPlayers([{ id, name: 'Mira', code: '271828' }]);
    await new Promise((resolve) => setTimeout(resolve, 4 * BATCH_MS));

    // A reload: seated again on the same seat, the join screen never asks.
    await first.reload();
    await until(() => gm.joined.length === 2, 'Mira seated again after the reload', 10_000);
    expect(gm.joined[1]?.id).toBe(id);
    expect(gm.knocks).toEqual([]);
    expect(await joinForm(first)).toBe(false);

    // Her other browser asks for the seat with her own code; the GM admits.
    const second = await browserPage();
    await second.goto(url);
    await second.fill('.join-input >> nth=0', 'Mira');
    await second.fill('.join-input >> nth=1', '271828');
    await second.click('.join-button');
    await until(() => gm.knocks.length === 1, 'GM asked', 10_000);
    gm.connection.answer(gm.knocks[0]?.id ?? '', true);
    await until(() => gm.joined.length === 3, 'seat moved to the other browser', 10_000);

    // The first page says where its seat went: not "another tab".
    await first.locator('.join-error').first().waitFor({ state: 'visible', timeout: 10_000 });
    const said = await first.locator('.join-error').first().textContent();
    expect(said).toContain('autre navigateur ou appareil');
    expect(said).toContain('accord du MJ');

    // Reloaded, it keeps no seat: it asks the player and nobody asks the GM.
    await first.reload();
    await first.locator('.join').waitFor({ state: 'visible', timeout: 10_000 });
    await first.waitForTimeout(1_000);
    expect(gm.knocks.length).toBe(1);
    expect(gm.joined.length).toBe(3);
  }, 60_000);
});
