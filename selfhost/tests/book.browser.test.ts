import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetChunks, sha256Hex } from '../../src/app/online/gm/assetServe.ts';
import type { AssetRef } from '../../src/app/online/protocol/asset.ts';
import { DEFAULT_BOOK_SLOTS } from '../../src/app/online/protocol/bookSlots.ts';
import type { PlayerBook } from '../../src/app/online/protocol/book.ts';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';
import { png } from './png.ts';

// The player's book on the built page, with the plugin's own connection code as the GM. The GM here
// answers asset requests as the plugin does, and never echoes a write it took: the page shows its own.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const SWORD = 'a'.repeat(24);
const OLD_NOTE = 'b'.repeat(24);
const QUEST = 'c'.repeat(24);
const WORLD = 'e'.repeat(24);
const CRYPT = 'f'.repeat(24);
const FOUND = '1'.repeat(24);
const QUEST_TEXT = 'La clé est sous l\'autel.\n![[autel.png]]\n<b>pas du HTML</b>';

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the player book in a browser', () => {
  let test: TestRelay;
  let browser: Browser;
  let page: Page;
  let gm: TestGm;
  let serving: ReturnType<typeof setInterval> | undefined;

  beforeAll(async () => {
    test = await startTestRelay();
    browser = await chromium.launch({ executablePath: CHROMIUM });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  });

  afterAll(async () => {
    clearInterval(serving);
    gm?.connection.stop();
    await browser?.close();
    await stopTestRelay(test);
  });

  it('shows every page and keeps what the player writes, as the GM keeps it', async () => {
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

    // The assets the book names, served when the page asks, as the plugin serves them.
    const files = new Map<string, Uint8Array>();
    const asset = async (bytes: Uint8Array, mime: string): Promise<AssetRef> => {
      const hash = await sha256Hex(bytes as Uint8Array<ArrayBuffer>);
      files.set(hash, bytes);
      return { hash, size: bytes.length, mime };
    };
    let answered = 0;
    serving = setInterval(() => {
      const requests = sentOf('asset-request');
      for (const request of requests.slice(answered)) {
        const bytes = files.get(request.hash as string);
        if (bytes !== undefined) for (const chunk of assetChunks(request.hash as string, bytes)) send(chunk, player);
      }
      answered = requests.length;
    }, 50);
    const textRef = await asset(new TextEncoder().encode(QUEST_TEXT), 'text/markdown');
    const altarRef = await asset(png(64, 48, () => [200, 40, 40]), 'image/png');
    const worldRef = await asset(png(400, 300, () => [40, 120, 60]), 'image/png');
    const cryptRef = await asset(png(200, 200, () => [60, 60, 60]), 'image/png');

    const book: PlayerBook = {
      character: { name: 'Mira', art: null, ring: '#3366ff', resources: [
        { key: 'hp', name: 'PV', colour: '#22c55e', direction: 'drains', current: 7, max: 10, editable: true },
        { key: 'ac', name: 'CA', colour: '#888888', direction: 'static', current: 15, max: 15, editable: false },
      ] },
      worldMap: { image: worldRef, width: 400, height: 300, id: WORLD, entrances: [{ x: 0.25, y: 0.25, to: CRYPT, title: 'Crypte', icon: 'dungeon' }], maps: [{ id: CRYPT, title: 'Crypte', image: cryptRef, width: 200, height: 200, entrances: [] }] },
      items: [{ id: SWORD, name: '<img src=x onerror="window.pwned=1">', type: 'Arme', rarity: 'Rare', tone: 'rare', price: '50 po', description: 'Une lame.', properties: [{ label: 'Dégâts', value: '1d8' }], at: 1 }],
      notes: [{ id: OLD_NOTE, title: 'Ancienne', body: 'Texte', at: 1 }],
      pins: [],
      quests: [{ id: QUEST, kind: 'main', state: 'active', title: 'La crypte', body: 'La clé est…', text: textRef, images: [{ target: 'autel.png', width: null, height: null, image: altarRef }], place: { x: 0.75, y: 0.5 }, xp: 100, rewards: ['Une épée'] }],
      purse: [{ name: 'Or', amount: 12 }],
      slots: DEFAULT_BOOK_SLOTS,
      equipped: [],
    };
    send({ t: 'book', book } as GmMessage, player);
    await page.waitForSelector('.atlas-bottom-toolbar-row__end button', { timeout: 5_000 });
    await page.click('.atlas-bottom-toolbar-row__end button');
    const tab = (name: string): Promise<void> => page.click(`.book-tab[data-tab="${name}"]`);

    // The sheet: a step shows at once and goes to the GM.
    expect(await page.textContent('.book-name')).toBe('Mira');
    expect(await page.locator('.book-resource-value').allTextContents()).toEqual(['7 / 10', '15']);
    expect(await page.locator('.book-resource').nth(1).locator('button').count()).toBe(0);
    await page.locator('.book-resource').first().locator('button >> text=+').click();
    expect(await page.locator('.book-resource-value').first().textContent()).toBe('8 / 10');
    await until(() => sentOf('book-resource').length === 1, 'resource sent', 5_000);
    expect(sentOf('book-resource')[0]).toEqual({ t: 'book-resource', key: 'hp', current: 8 });

    // Items as text, and a new one handed over is told.
    await tab('items');
    expect(await page.textContent('.book-item-name')).toBe('<img src=x onerror="window.pwned=1">');
    expect(await page.locator('.book img').count()).toBe(0);
    send({ t: 'book-item', item: { ...book.items[0]!, id: 'd'.repeat(24), name: 'Corde', tone: null } } as GmMessage, player);
    await page.waitForFunction(() => document.querySelectorAll('.book-item').length === 2, null, { timeout: 5_000 });
    expect(await page.textContent('.notice')).toBe('Nouvel objet : Corde');

    // Equipment: the sword goes into the main hand; a default slot hidden, one of the player's own added.
    await tab('equipment');
    await page.selectOption('select[data-slot="main-hand"]', SWORD);
    await until(() => sentOf('book-equip').length === 1, 'equip sent', 5_000);
    expect(sentOf('book-equip')[0]).toEqual({ t: 'book-equip', item: SWORD, slot: 'main-hand' });
    expect(await page.locator('select[data-slot="off-hand"] option').allTextContents()).not.toContain(book.items[0]!.name);
    await page.click('.book-slot-settings summary');
    await page.locator('.book-slot-setting', { hasText: 'Munitions' }).locator('button').click();
    await until(() => sentOf('book-slots').length === 1, 'slots sent', 5_000);
    expect(sentOf('book-slots')[0]).toEqual({ t: 'book-slots', slots: { hidden: ['ammunition'], own: [] } });
    expect(await page.locator('select[data-slot="ammunition"]').count()).toBe(0);
    await page.fill('.book-inline-form input', 'Sac à dos');
    await page.click('.book-inline-form button');
    await until(() => sentOf('book-slots').length === 2, 'own slot sent', 5_000);
    const own = (sentOf('book-slots')[1]?.slots as { own: { id: string; name: string }[] }).own;
    expect(own.map((slot) => slot.name)).toEqual(['Sac à dos']);
    expect(own[0]?.id).toMatch(/^[0-9a-f]{24}$/);
    expect(await page.locator('.book-slot-name', { hasText: 'Sac à dos' }).count()).toBe(2);
    await tab('items');
    expect(await page.locator('.book-item-slot').allTextContents()).toEqual(['Équipé : Main principale']);

    // Notes: a new one shows at once, without the GM sending anything back; edited in place; deleted.
    await tab('notes');
    await page.fill('.book-form input', 'Indice');
    await page.fill('.book-form textarea', 'Le forgeron ment.');
    await page.click('.book-form button[type=submit]');
    await until(() => sentOf('book-note').length === 1, 'note sent', 5_000);
    const note = sentOf('book-note')[0]?.note as { id: string; title: string; body: string };
    expect(note).toMatchObject({ title: 'Indice', body: 'Le forgeron ment.' });
    expect(note.id).toMatch(/^[0-9a-f]{24}$/);
    expect(await page.locator('.book-note .book-item-name').allTextContents()).toEqual(['Indice', 'Ancienne']);
    await page.locator('.book-note', { hasText: 'Indice' }).locator('button >> text=Modifier').click();
    await page.fill('.book-form textarea', 'Le forgeron ment, et le maire aussi.');
    await page.click('.book-form button[type=submit]');
    await until(() => sentOf('book-note').length === 2, 'edit sent', 5_000);
    expect((sentOf('book-note')[1]?.note as { id: string }).id).toBe(note.id);
    await page.locator('.book-note', { hasText: 'Ancienne' }).locator('button >> text=Supprimer').click();
    await until(() => sentOf('book-note-delete').length === 1, 'delete sent', 5_000);
    expect(await page.locator('.book-note .book-text').allTextContents()).toEqual(['Le forgeron ment, et le maire aussi.']);

    // What is typed survives a message from the GM that draws the book again.
    await page.fill('.book-form input', 'Brouillon');
    send({ t: 'book-sheet', character: book.character } as GmMessage, player);
    await page.waitForTimeout(200);
    expect(await page.inputValue('.book-form input')).toBe('Brouillon');

    // Quests: the whole text with its image where it embeds it, the rewards, and the player's notes on it.
    await tab('quests');
    await page.waitForFunction(() => (document.querySelector('.book-quest .doc-image') as HTMLImageElement | null)?.naturalWidth === 64, null, { timeout: 5_000 });
    const text = await page.locator('.book-quest .doc-text').textContent();
    expect(text).toContain('La clé est sous l\'autel.');
    expect(text).toContain('<b>pas du HTML</b>');
    expect(await page.locator('.book-quest b').count()).toBe(0);
    expect(await page.locator('.book-rewards li').allTextContents()).toEqual(['Une épée']);
    await page.fill('.book-quest .book-form input', 'Autel');
    await page.click('.book-quest .book-form button[type=submit]');
    await until(() => sentOf('book-note').length === 3, 'quest note sent', 5_000);
    expect((sentOf('book-note')[2]?.note as { quest: string }).quest).toBe(QUEST);

    // The world map: the quest's place, an entrance into the crypt, and a pin of the player's own there.
    await page.click('.book-quest button >> text=Voir sur la carte');
    expect(await page.locator('.map-quest.map-chosen').count()).toBe(1);
    expect(await page.locator('.map-card .book-item-name').textContent()).toBe('La crypte');
    await page.click('.map-entrance');
    await page.click('.map-card button >> text=Entrer');
    expect(await page.textContent('.map-title')).toBe('Crypte');
    await page.waitForFunction(() => (document.querySelector('.book-map') as HTMLImageElement | null)?.naturalWidth === 200, null, { timeout: 5_000 });
    await page.click('.map-head button >> text=Ajouter une épingle');
    const frame = await page.locator('.map-frame').boundingBox();
    await page.mouse.click((frame?.x ?? 0) + (frame?.width ?? 0) * 0.5, (frame?.y ?? 0) + (frame?.height ?? 0) * 0.25);
    await page.selectOption('.map-card select', 'treasure');
    await page.fill('.map-card input', 'Coffre');
    await page.click('.map-card button[type=submit]');
    await until(() => sentOf('book-pin').length === 1, 'pin sent', 5_000);
    const pin = sentOf('book-pin')[0]?.pin as { map: string; x: number; y: number; kind: string; title: string };
    expect(pin).toMatchObject({ map: CRYPT, kind: 'treasure', title: 'Coffre' });
    expect(pin.x).toBeCloseTo(0.5, 1);
    expect(pin.y).toBeCloseTo(0.25, 1);
    expect(await page.locator('.map-pin-treasure').count()).toBe(1);
    await page.click('.map-head button >> text=Retour à la carte du monde');
    expect(await page.locator('.map-pin-treasure').count()).toBe(0);

    // The purse.
    await tab('purse');
    await page.fill('.book-amount', '20');
    await page.click('.book-form button[type=submit]');
    await until(() => sentOf('book-purse').length === 1, 'purse sent', 5_000);
    expect(sentOf('book-purse')[0]).toEqual({ t: 'book-purse', purse: [{ name: 'Or', amount: 20 }] });

    // A refused write is answered with the whole book, which the page takes as it is.
    send({ t: 'book', book } as GmMessage, player);
    await tab('notes');
    await page.waitForFunction(() => [...document.querySelectorAll('.book-note .book-item-name')].map((el) => el.textContent).join() === 'Ancienne', null, { timeout: 5_000 });
    await page.click('.book-close');

    // A found pin's note opens in the reader from the log; a refused roll is told.
    send({ t: 'log', entries: [{ id: FOUND, at: Date.now(), who: player, name: 'Mira', kind: 'found', title: 'Lettre', body: 'Rendez-vous à minuit.' }] } as GmMessage, player);
    await page.click('.atlas-bottom-toolbar-row__start button');
    await page.click('.atlas-online-log__found-title');
    expect(await page.textContent('.reader-title')).toBe('Lettre');
    expect(await page.textContent('.reader .doc-text')).toBe('Rendez-vous à minuit.');
    await page.keyboard.press('Escape');
    expect(await page.locator('.reader').count()).toBe(0);
    send({ t: 'roll-refused', reason: 'rate' } as GmMessage, player);
    await page.waitForFunction(() => document.querySelector('.notice')?.textContent?.startsWith('Trop de jets'), null, { timeout: 5_000 });
    expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
  }, 60_000);
});
