import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompendiumShare } from '../../src/app/online/gm/compendium/CompendiumShare.ts';
import { DND5E_2024 } from '../../src/app/characterSheets/dnd5e2024.ts';
import { applySheetEdit, newSheet } from '../../src/app/characterSheets/sheetNote.ts';
import { pickResult } from '../../src/app/compendium/sheetPickEdits.ts';
import type { SheetValues } from '../../src/app/characterSheets/sheetFields.ts';
import type { GmMessage } from '../../src/app/online/protocol/game.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';

// A player's sheet reaching the compendium through the GM: the plugin's own share code as the GM, the built page in a browser.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const SHOTS = process.env.ATLAS_SHOTS;
const SHEET = 'Personnages/Mira.md';
const WIZARD = 'Compendium/X/Classes/Wizard.md';
const FIGHTER = 'Compendium/X/Classes/Fighter.md';
const DIE: Record<string, string> = { [WIZARD]: 'd6', [FIGHTER]: 'd10' };

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the compendium from a player\'s sheet, in a browser', () => {
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

  it('picks classes from the campaign\'s list, reads one, and comes back to the sheet', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const shot = async (name: string): Promise<void> => {
      if (SHOTS !== undefined) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    };
    let values: SheetValues = { ...newSheet(DND5E_2024, 'Mira') };
    let player = '';
    const sendSheet = (): void => gm.connection.send({ t: 'sheet', sheet: { system: 'dnd5e-2024', values }, notes: [] } as GmMessage, player);
    const share = new CompendiumShare({
      send: (body, to) => gm.connection.send(body, to),
      nameOf: () => 'Ana',
      identify: async () => 'ana',
      sharesOf: () => [],
      describe: (notePath) => ({ title: notePath.split('/').at(-1)?.replace('.md', '') ?? notePath, kind: 'class' }),
      read: async (notePath) => ({
        title: notePath.split('/').at(-1)?.replace('.md', '') ?? notePath, kind: 'class',
        content: { rows: [{ label: 'Hit Die', value: DIE[notePath] ?? '' }], sections: [], text: 'A scholarly magic-user.' }, fields: [],
      }),
      write: async () => true,
      now: () => Date.now(),
      sheetOf: () => SHEET,
      sheetChoices: async () => [{ path: FIGHTER, name: 'Fighter', detail: 'd10' }, { path: WIZARD, name: 'Wizard', detail: 'd6' }],
      pick: async (_sheet, kind, entry) => {
        // The GM's Atlas writes the note; the sheet reaches the player as it changes.
        for (const edit of pickResult(kind, entry === WIZARD ? 'Wizard' : 'Fighter', { 'hit-die': DIE[entry] }, '', values).edits) values = applySheetEdit(DND5E_2024, values, edit) ?? values;
        sendSheet();
        return true;
      },
      findEntry: async (_kind, name) => (name === 'Wizard' ? WIZARD : name === 'Fighter' ? FIGHTER : null),
      sheetLinks: () => [],
    });
    gm.onMessage = (from, body) => void share.receive(from, body);

    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Ana');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    player = gm.joined[0]?.id ?? '';
    gm.connection.send({ t: 'book', book: { character: { name: 'Mira', art: null, ring: null, resources: [] }, worldMap: null, items: [], notes: [], pins: [], quests: [], purse: [], slots: { hidden: [], own: [] }, equipped: [] } } as GmMessage, player);
    sendSheet();

    await page.waitForSelector('.atlas-bottom-toolbar-row__end button', { timeout: 5_000 });
    await page.click('.atlas-bottom-toolbar-row__end button');
    await page.click('.book-tab[data-tab="sheet"]');
    await page.click('button:has-text("+ Classe")');
    await page.waitForSelector('.atlas-sheet-picker__choice');
    expect(await page.locator('.atlas-sheet-picker__choice').allTextContents()).toEqual(['Fighterd10', 'Wizardd6']);
    await shot('sheet-picker');
    // No button to make a class: that is the GM's.
    expect(await page.locator('.atlas-sheet-picker button:has-text("+")').count()).toBe(0);
    await page.click('.atlas-sheet-picker__choice:has-text("Fighter")');
    await page.waitForSelector('.atlas-sheet-class__name:has-text("Fighter")');
    await page.click('button:has-text("+ Classe")');
    await page.click('.atlas-sheet-picker__choice:has-text("Wizard")');
    await page.waitForSelector('.atlas-sheet-class__name:has-text("Wizard")');
    expect(await page.inputValue('[aria-label="Niveau"]')).toBe('2');
    await shot('sheet-multiclass');

    // Reading a class of the sheet: its page in the compendium tab, then back to the sheet.
    await page.click('button[aria-label="Voir Wizard"]');
    await page.waitForSelector('.cpd-card .cpd-title:has-text("Wizard")');
    expect(await page.locator('.cpd-text p').textContent()).toBe('A scholarly magic-user.');
    await shot('sheet-view-class');
    await page.click('.cpd-back');
    await page.waitForSelector('.atlas-sheet');
  }, 60_000);
});
