import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sheetBase, type BookStatblock } from '../../src/app/online/protocol/book.ts';
import { DEFAULT_BOOK_SLOTS } from '../../src/app/online/protocol/bookSlots.ts';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, storeAsset, until, type TestRelay } from './helpers.ts';

// The player's statblock on the built page, with the plugin's own connection code as the GM.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const SHOTS = process.env.ATLAS_SHOTS;

const STATBLOCK: BookStatblock = {
  editable: true,
  displayName: 'Mira',
  sigils: { hp: { label: 'PV', look: 'plain', text: { opening: '20' }, field: null, prompt: null, resource: 'hp' } },
  blocks: [
    { k: 'section', heading: 'Traits', nodes: [
      { k: 'value', value: { label: 'Vitesse', look: 'plain', text: { opening: '30 ft.' }, field: { key: 'speed', base: sheetBase('30 ft.'), type: 'text', value: '30 ft.' }, prompt: null } },
    ] },
    { k: 'table', label: 'Caractéristiques', columns: ['FOR', 'DEX'], rows: [['8', '16']], worked: [['-1', '+3']], rolls: [[null, null]], workedRolls: [['-1', '+3']], field: null },
  ],
  abilities: [{ id: 'act', name: 'Actions', access: 'edit', parts: [], tabs: [{ label: null, list: 'actions', entries: [{ key: sheetBase('Dague'), name: 'Dague', text: { opening: 'Une lame courte.' }, parts: {} }] }] }],
};

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the player\'s statblock in a browser', () => {
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

  it('draws the statblock, sends what the player changes and rolls, picks from the compendium, and opens the GM\'s documents', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const sentOf = (type: string): Record<string, unknown>[] => gm.messages.map((m) => m.body as Record<string, unknown>).filter((body) => body.t === type);
    const shot = async (name: string): Promise<void> => {
      if (SHOTS !== undefined) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    };

    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Ana');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    const player = gm.joined[0]?.id ?? '';
    const send = (body: GmMessage): void => gm.connection.send(body, player);
    gm.onMessage = (_from, body) => {
      if ((body as { t?: string }).t === 'sheet-choices') send({ t: 'sheet-choices', kind: 'class', choices: [{ id: 'c1', name: 'Magicien', detail: 'd6' }] });
    };

    const loreRef = await storeAsset(test, new TextEncoder().encode('# Famille\n\nTa sœur vit à Port-Brume.'), 'text/markdown', 'text');
    send({ t: 'scene', scene: { id: 's1', map: null, lit: false } } as GmMessage);
    send({ t: 'book', book: { character: { name: 'Mira', art: null, ring: null, resources: [{ key: 'hp', name: 'PV', colour: '#22c55e', direction: 'drains', current: 20, max: 33, editable: true, maxEditable: false }] }, worldMap: null, items: [], notes: [], pins: [], quests: [], purse: [], slots: DEFAULT_BOOK_SLOTS, equipped: [] } } as GmMessage);
    send({ t: 'book-statblock', statblock: STATBLOCK });
    send({ t: 'character-notes', notes: [{ title: 'Famille de Mira', body: 'Ta sœur…', text: loreRef }] });

    await page.waitForSelector('.atlas-bottom-toolbar-row__end button', { timeout: 5_000 });
    await page.click('.atlas-bottom-toolbar-row__end button');
    await page.click('.book-tab[data-tab="sheet"]');
    await page.waitForSelector('.sb-page .book-name:has-text("Mira")');
    await shot('statblock');

    // A value of the player's: sent against the base the sheet showed.
    await page.fill('[aria-label="Vitesse"]', '35 ft.');
    await page.press('[aria-label="Vitesse"]', 'Enter');
    await until(() => sentOf('book-field').length === 1, 'field sent', 5_000);
    expect(sentOf('book-field')[0]).toEqual({ t: 'book-field', key: 'speed', base: sheetBase('30 ft.'), value: '35 ft.' });

    // A worked-out modifier rolls for the character; hit points are the token's resource.
    await page.click('button[aria-label="Lancer Caractéristiques DEX"]');
    await until(() => sentOf('roll').length === 1, 'roll sent', 5_000);
    expect(sentOf('roll')[0]).toEqual({ t: 'roll', scene: 's1', formula: '+3', token: null, flavor: 'Caractéristiques DEX' });
    await page.click('button[aria-label="Diminuer PV"]');
    await until(() => sentOf('book-resource').length === 1, 'hit points sent', 5_000);
    expect(sentOf('book-resource')[0]).toEqual({ t: 'book-resource', key: 'hp', current: 19 });

    // An ability of a list of the player's.
    await page.click('.sb-ability button:has-text("Supprimer")');
    await until(() => sentOf('book-ability').length === 1, 'ability sent', 5_000);
    expect(sentOf('book-ability')[0]).toEqual({ t: 'book-ability', op: 'remove', list: 'actions', key: sheetBase('Dague') });

    // The compendium bar asks the GM for the campaign's classes and picks one.
    await page.click('button:has-text("+ Classe")');
    await page.click('.atlas-sheet-picker__choice:has-text("Magicien")');
    await until(() => sentOf('sheet-pick').length === 1, 'pick sent', 5_000);
    expect(sentOf('sheet-pick')[0]).toEqual({ t: 'sheet-pick', kind: 'class', id: 'c1' });

    // The notes the GM linked to the character, in the compendium tab.
    await page.click('.book-tab[data-tab="compendium"]');
    await page.click('.cpd-entry >> text=Famille de Mira');
    await page.waitForFunction(() => document.querySelector('.reader .doc-text')?.textContent?.includes('Port-Brume'), null, { timeout: 5_000 });
  }, 60_000);
});
