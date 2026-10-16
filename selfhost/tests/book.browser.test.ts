import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetChunks, sha256Hex } from '../../src/app/online/gm/assetServe.ts';
import { DEFAULT_BOOK_SLOTS } from '../../src/app/online/protocol/bookSlots.ts';
import type { PlayerBook } from '../../src/app/online/protocol/book.ts';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';

// The player's book on the built page, with the plugin's own connection code as the GM.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const QUEST_TEXT = '# La crypte\n\nTrouver la clé sous l\'autel.\n\n<b>pas du HTML</b>';

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the player book in a browser', () => {
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

  it('shows the book and sends what the player writes in it', async () => {
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

    const textBytes = new TextEncoder().encode(QUEST_TEXT);
    const textHash = await sha256Hex(textBytes as Uint8Array<ArrayBuffer>);
    const book: PlayerBook = {
      character: { name: 'Mira', art: null, ring: '#3366ff', resources: [
        { key: 'hp', name: 'PV', colour: '#22c55e', direction: 'drains', current: 7, max: 10, editable: true },
        { key: 'ac', name: 'CA', colour: '#888888', direction: 'static', current: 15, max: 15, editable: false },
      ] },
      worldMap: null,
      items: [{ id: 'a'.repeat(24), name: '<img src=x onerror="window.pwned=1">', type: 'Arme', rarity: 'Rare', tone: 'rare', price: '50 po', description: 'Une lame.', properties: [{ label: 'Dégâts', value: '1d8' }], at: 1 }],
      notes: [{ id: 'b'.repeat(24), title: 'Ancienne', body: 'Texte', at: 1 }],
      pins: [],
      quests: [{ id: 'c'.repeat(24), kind: 'main', state: 'active', title: 'La crypte', body: 'Trouver la clé…', text: { hash: textHash, size: textBytes.length, mime: 'text/markdown' }, place: null, xp: 100, rewards: [] }],
      purse: [{ name: 'Or', amount: 12 }],
      slots: DEFAULT_BOOK_SLOTS,
      equipped: [],
    };
    send({ t: 'book', book } as GmMessage, player);
    await page.waitForSelector('.book-toggle:not([hidden])', { timeout: 5_000 });
    await page.click('.book-toggle');

    // The sheet: the name, both resources, and a step on the one the player may change.
    expect(await page.textContent('.book-name')).toBe('Mira');
    expect(await page.locator('.book-resource-value').allTextContents()).toEqual(['7 / 10', '15']);
    expect(await page.locator('.book-resource').nth(1).locator('button').count()).toBe(0);
    await page.locator('.book-resource').first().locator('button >> text=+').click();
    await until(() => sentOf('book-resource').length === 1, 'resource sent', 5_000);
    expect(sentOf('book-resource')[0]).toEqual({ t: 'book-resource', key: 'hp', current: 8 });
    send({ t: 'book-sheet', character: { ...book.character!, resources: [{ ...book.character!.resources[0]!, current: 8 }] } } as GmMessage, player);
    await page.waitForFunction(() => document.querySelector('.book-resource-value')?.textContent === '8 / 10', null, { timeout: 5_000 });

    // Items as text: the name that looks like markup stays text.
    await page.click('.book-tab >> text=Objets');
    expect(await page.textContent('.book-item-name')).toBe('<img src=x onerror="window.pwned=1">');
    expect(await page.locator('.book img').count()).toBe(0);
    send({ t: 'book-item', item: { ...book.items[0]!, id: 'd'.repeat(24), name: 'Corde', tone: null } } as GmMessage, player);
    await page.waitForFunction(() => document.querySelectorAll('.book-item').length === 2, null, { timeout: 5_000 });

    // Notes: a new one goes to the GM with a fresh id; the old one can be deleted.
    await page.click('.book-tab >> text=Notes');
    await page.fill('.book-form input', 'Indice');
    await page.fill('.book-form textarea', 'Le forgeron ment.');
    await page.click('.book-form button[type=submit]');
    await until(() => sentOf('book-note').length === 1, 'note sent', 5_000);
    const note = sentOf('book-note')[0]?.note as { id: string; title: string; body: string };
    expect(note.title).toBe('Indice');
    expect(note.body).toBe('Le forgeron ment.');
    expect(note.id).toMatch(/^[0-9a-f]{24}$/);
    await page.click('.book-note button >> text=Supprimer');
    await until(() => sentOf('book-note-delete').length === 1, 'delete sent', 5_000);
    expect(sentOf('book-note-delete')[0]).toEqual({ t: 'book-note-delete', id: 'b'.repeat(24) });

    // Quests: the whole text, fetched by hash, shown as text.
    await page.click('.book-tab >> text=Quêtes');
    expect(await page.textContent('.book-quest .book-item-name')).toBe('La crypte');
    for (const chunk of assetChunks(textHash, textBytes)) send(chunk, player);
    await page.waitForFunction((expected) => [...document.querySelectorAll('.book-quest .book-text')].some((element) => element.textContent === expected), QUEST_TEXT, { timeout: 5_000 });
    expect(await page.locator('.book-quest b').count()).toBe(0);

    // The purse: the player's count goes to the GM.
    await page.click('.book-tab >> text=Bourse');
    await page.fill('.book-amount', '20');
    await page.click('.book-form button[type=submit]');
    await until(() => sentOf('book-purse').length === 1, 'purse sent', 5_000);
    expect(sentOf('book-purse')[0]).toEqual({ t: 'book-purse', purse: [{ name: 'Or', amount: 20 }] });

    await page.click('.book-tab >> text=Carte');
    expect(await page.textContent('.book-empty')).toContain('carte du monde');
    expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
  }, 60_000);
});
