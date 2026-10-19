import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetChunks, sha256Hex } from '../../src/app/online/gm/assetServe.ts';
import { DND5E_2024 } from '../../src/app/characterSheets/dnd5e2024.ts';
import { newSheet } from '../../src/app/characterSheets/sheetNote.ts';
import { DEFAULT_BOOK_SLOTS } from '../../src/app/online/protocol/bookSlots.ts';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';

// The player's character sheet and documents on the built page, with the plugin's own connection code as the GM.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const SHOTS = process.env.ATLAS_SHOTS;
const LORE = '# Famille\n\nTa sœur vit à Port-Brume.';

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the player\'s character sheet in a browser', () => {
  let test: TestRelay;
  let browser: Browser;
  let page: Page;
  let gm: TestGm;

  beforeAll(async () => {
    test = await startTestRelay();
    browser = await chromium.launch({ executablePath: CHROMIUM });
    page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  });

  afterAll(async () => {
    gm?.connection.stop();
    await browser?.close();
    await stopTestRelay(test);
  });

  it('shows the sheet, rolls from it, sends what the player changes, and opens the GM\'s documents', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const send = (body: GmMessage, to: string): void => gm.connection.send(body, to);
    const sentOf = (type: string): Record<string, unknown>[] => gm.messages.map((m) => m.body as Record<string, unknown>).filter((body) => body.t === type);
    const shot = async (name: string): Promise<void> => {
      if (SHOTS !== undefined) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    };

    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Ana');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';

    const lore = new TextEncoder().encode(LORE);
    const loreHash = await sha256Hex(lore as Uint8Array<ArrayBuffer>);
    const values = { ...newSheet(DND5E_2024, 'Mira'), level: 5, class: 'Roublarde', stats: [8, 16, 14, 12, 13, 10], 'skill-proficiencies': ['perception'] };
    send({ t: 'scene', scene: { id: 's1', map: null, lit: false } } as GmMessage, player);
    send({ t: 'book', book: { character: { name: 'Mira', art: null, ring: null, resources: [{ key: 'hp', name: 'PV', colour: '#22c55e', direction: 'drains', current: 20, max: 33, editable: true }] }, worldMap: null, items: [], notes: [], pins: [], quests: [], purse: [], slots: DEFAULT_BOOK_SLOTS, equipped: [] } } as GmMessage, player);
    send({ t: 'sheet', sheet: { system: 'dnd5e-2024', values }, notes: [{ title: 'Famille de Mira', body: 'Ta sœur…', text: { hash: loreHash, size: lore.length, mime: 'text/markdown' } }] } as GmMessage, player);

    await page.waitForSelector('.atlas-bottom-toolbar-row__end button', { timeout: 5_000 });
    await page.click('.atlas-bottom-toolbar-row__end button');
    await page.click('.book-tab[data-tab="sheet"]');
    await page.waitForSelector('.atlas-sheet');
    expect(await page.inputValue('[aria-label="Nom du personnage"]')).toBe('Mira');
    expect(await page.inputValue('[aria-label="PV actuels"]')).toBe('20');
    await shot('sheet-main');

    // A click on Dexterity's modifier rolls it for the character.
    await page.click('button[aria-label="Test de Dextérité : +3"]');
    await until(() => sentOf('roll').length === 1, 'roll sent', 5_000);
    expect(sentOf('roll')[0]).toEqual({ t: 'roll', scene: 's1', formula: '1d20+3', token: null, flavor: 'Test de Dextérité' });

    // The level: the proficiency bonus follows at once, the GM is told once the typing pauses.
    await page.fill('[aria-label="Niveau"]', '9');
    expect(await page.locator('.atlas-sheet-badge', { hasText: 'Bonus de maîtrise' }).locator('strong').textContent()).toBe('+4');
    await until(() => sentOf('sheet-edit').some((edit) => edit.key === 'level'), 'level sent', 5_000);
    expect(sentOf('sheet-edit').filter((edit) => edit.key === 'level').at(-1)).toEqual({ t: 'sheet-edit', key: 'level', value: 9 });
    // An older sheet from the GM does not undo what was just changed.
    send({ t: 'sheet', sheet: { system: 'dnd5e-2024', values }, notes: [] } as GmMessage, player);
    await page.waitForTimeout(200);
    expect(await page.inputValue('[aria-label="Niveau"]')).toBe('9');

    await page.click('[aria-label="Maîtrise Discrétion (DEX)"]');
    await until(() => sentOf('sheet-edit').some((edit) => edit.key === 'skill-proficiencies'), 'proficiency sent', 5_000);
    expect(sentOf('sheet-edit').find((edit) => edit.key === 'skill-proficiencies')?.value).toEqual(['perception', 'stealth']);

    // Hit points are the token's own, as on the character page.
    await page.fill('[aria-label="PV actuels"]', '15');
    await until(() => sentOf('book-resource').length >= 1, 'hit points sent', 5_000);
    expect(sentOf('book-resource').at(-1)).toEqual({ t: 'book-resource', key: 'hp', current: 15 });

    // A row of attacks: added at once, its name once the typing pauses. What the character carries is the book's, not the sheet's.
    expect(await page.locator('.atlas-sheet-tab >> text=Équipement').count()).toBe(0);
    await page.click('.atlas-sheet-tab >> text=Principal');
    await page.click('.atlas-sheet-add >> text=Ajouter');
    await until(() => sentOf('sheet-row').length === 1, 'row sent', 5_000);
    await page.fill('[aria-label="Nom"]', 'Dague');
    await until(() => sentOf('sheet-row').some((row) => (row.row as { name?: string } | null)?.name === 'Dague'), 'row name sent', 5_000);
    expect(sentOf('sheet-row').at(-1)).toEqual({ t: 'sheet-row', key: 'attacks', index: 0, row: { name: 'Dague', bonus: '', damage: '', notes: '' } });
    await shot('sheet-attack');

    // The GM's documents: the note's whole text, fetched by hash.
    send({ t: 'sheet', sheet: { system: 'dnd5e-2024', values }, notes: [{ title: 'Famille de Mira', body: 'Ta sœur…', text: { hash: loreHash, size: lore.length, mime: 'text/markdown' } }] } as GmMessage, player);
    await page.click('.book-tab[data-tab="documents"]');
    await page.click('.book-document button >> text=Lire');
    await until(() => sentOf('asset-request').some((request) => request.hash === loreHash), 'text asked for', 5_000);
    for (const chunk of assetChunks(loreHash, lore)) send(chunk, player);
    await page.waitForFunction(() => document.querySelector('.reader .doc-text')?.textContent?.includes('Port-Brume'), null, { timeout: 5_000 });
    expect(await page.textContent('.reader-title')).toBe('Famille de Mira');
    await shot('sheet-document');

    // The GM put the sheet under the 2014 rules: the same sheet, in that edition's words.
    await page.click('.reader-close');
    send({ t: 'sheet', sheet: { system: 'dnd5e-2014', values }, notes: [] } as GmMessage, player);
    await page.click('.book-tab[data-tab="sheet"]');
    await page.waitForSelector('.atlas-sheet[data-system="dnd5e-2014"]', { timeout: 5_000 });
    expect(await page.locator('[aria-label="Race"]').count()).toBe(1);
  }, 60_000);
});
