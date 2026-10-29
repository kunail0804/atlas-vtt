import { existsSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CompendiumShare, type PageRead } from '../../src/app/online/gm/compendium/CompendiumShare.ts';
import { EMPTY_ROSTER, identifyDevice, setShares, sharesOf, type Roster } from '../../src/app/players/roster.ts';
import { sha256Hex } from '../../src/app/online/gm/assetServe.ts';
import { TestGm, createTable, startTestRelay, stopTestRelay, until, type TestRelay } from './helpers.ts';

// The compendium pages a GM shares, on the built page, with the plugin's own connection and share code as the GM.
const CHROMIUM = '/usr/bin/chromium';
const BUILT = path.join(import.meta.dirname, '..', 'player', 'dist', 'index.html');
const SHOTS = process.env.ATLAS_SHOTS;
const FIRE = 'Compendium/SRD/Spells/Fireball.md';
const GOBLIN = 'Compendium/SRD/Monsters/Goblin.md';

describe.skipIf(!existsSync(CHROMIUM) || !existsSync(BUILT))('the compendium pages a player is shared, in a browser', () => {
  let test: TestRelay;
  let browser: Browser;
  let page: Page;
  let gm: TestGm;

  beforeAll(async () => {
    test = await startTestRelay();
    browser = await chromium.launch({ executablePath: CHROMIUM });
    page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  });

  afterAll(async () => {
    gm?.connection.stop();
    await browser?.close();
    await stopTestRelay(test);
  });

  it('knows the player from their device, lists their pages, reads them as cards, and writes their change', async () => {
    const created = await createTable(test.gmOrigin);
    gm = new TestGm(test.gmOrigin, created.code, created.secret);
    await until(() => gm.status === 'online', 'GM online');
    const shot = async (name: string): Promise<void> => {
      if (SHOTS !== undefined) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    };

    // The vault: its players (none yet) and two notes, the Fireball's level and text changeable.
    let roster: Roster = EMPTY_ROSTER;
    const fire = { level: '3', text: 'A bright streak flashes.\n\n| Slot | Damage |\n| --- | --- |\n| 3rd | 8d6 |' };
    const read = async (notePath: string): Promise<PageRead | null> => {
      if (notePath === FIRE) {
        return {
          title: 'Fireball', kind: 'spell',
          content: { rows: [{ label: 'Level', value: fire.level }, { label: 'School', value: 'Evocation' }], sections: [], text: fire.text },
          fields: [{ key: 'level', label: 'Level', value: fire.level }],
        };
      }
      return notePath === GOBLIN ? {
        title: 'Goblin', kind: 'monster',
        content: { rows: [{ label: 'Armor Class', value: '15 (leather armor, shield)' }], sections: [{ heading: 'Actions', entries: [{ name: 'Scimitar', text: 'Melee Weapon Attack: +4 to hit.' }] }], text: '' },
        fields: [],
      } : null;
    };
    let ids = 0;
    const share = new CompendiumShare({
      send: (body, to) => gm.connection.send(body, to),
      nameOf: (player) => gm.joined.find((joined) => joined.id === player)?.name ?? null,
      identify: async (key, name) => {
        const device = await sha256Hex(new TextEncoder().encode(key) as Uint8Array<ArrayBuffer>);
        const identified = identifyDevice(roster, device, name, Date.now(), () => `p${(++ids).toString(16).padStart(8, '0')}`);
        roster = identified.roster;
        if (Object.keys(roster.shares).length === 0) roster = setShares(roster, [FIRE], { [identified.id]: 'write' });
        if (!roster.shares[GOBLIN]) roster = setShares(roster, [GOBLIN], { [identified.id]: 'read' });
        return identified.id;
      },
      sharesOf: (id) => sharesOf(roster, id),
      describe: (notePath) => (notePath === FIRE ? { title: 'Fireball', kind: 'spell' } : notePath === GOBLIN ? { title: 'Goblin', kind: 'monster' } : null),
      read,
      write: async (notePath, edit, allowed) => {
        if (notePath !== FIRE) return false;
        if (allowed.includes('level') && edit.fields.level !== undefined) fire.level = edit.fields.level;
        fire.text = edit.text;
        setTimeout(() => share.noteChanged(FIRE), 0);
        return true;
      },
      now: () => Date.now(),
    });
    gm.onMessage = (from, body) => void share.receive(from, body);

    await page.goto(`http://127.0.0.1:${test.relay.publicPort}/#${created.code}`);
    await page.fill('.join-input >> nth=0', 'Ana');
    await page.click('.join-button');
    await until(() => gm.joined.length === 1, 'player seated', 10_000);
    await until(() => Object.keys(roster.players).length === 1, 'player known', 5_000);
    const [anaId] = Object.keys(roster.players);

    // No character, but shared pages: the book opens on them.
    await page.waitForSelector('.atlas-bottom-toolbar-row__end button', { timeout: 5_000 });
    await page.click('.atlas-bottom-toolbar-row__end button');
    await page.click('.book-tab[data-tab="compendium"]');
    await page.waitForSelector('.cpd-entry');
    expect(await page.locator('.cpd-kind-heading').allTextContents()).toEqual(['Sorts', 'Créatures']);
    await shot('compendium-list');

    await page.click('.cpd-entry:has-text("Goblin")');
    await page.waitForSelector('.cpd-card');
    expect(await page.locator('.cpd-row .cpd-value').first().textContent()).toBe('15 (leather armor, shield)');
    expect(await page.locator('.cpd-section').textContent()).toBe('Actions');
    expect(await page.locator('.cpd-edit').count()).toBe(0);
    await shot('compendium-goblin');

    await page.click('.cpd-back');
    await page.click('.cpd-entry:has-text("Fireball")');
    await page.waitForSelector('.cpd-card .md-table table');
    expect(await page.locator('.cpd-text td').allTextContents()).toEqual(['3rd', '8d6']);
    // Never markup: the text's table is built of cells, nothing the note wrote runs as HTML.
    await shot('compendium-fireball');

    await page.click('.cpd-edit');
    await page.fill('.cpd-form input', '4');
    await page.fill('.cpd-form textarea', 'A brighter streak.');
    await shot('compendium-edit');
    await page.click('.cpd-form button[type="submit"]');
    await until(() => fire.level === '4' && fire.text === 'A brighter streak.', 'change written', 5_000);
    await page.waitForSelector('.cpd-card .cpd-text p');
    expect(await page.locator('.cpd-text p').textContent()).toBe('A brighter streak.');
    expect(await page.locator('.cpd-row .cpd-value').first().textContent()).toBe('4');

    // The GM takes the Fireball back: it leaves the player's list, and the open page closes.
    roster = setShares(roster, [FIRE], { [anaId ?? '']: null });
    share.sharesChanged();
    await page.waitForSelector('.cpd-list');
    expect(await page.locator('.cpd-entry').allTextContents()).toEqual(['Goblin']);

    // A reload is the same device: the same player, with the same pages.
    gm.messages.length = 0;
    await page.reload();
    await page.fill('.join-input >> nth=0', 'Ana (tablette)');
    await page.click('.join-button');
    await until(() => gm.messages.some((message) => (message.body as { t?: string }).t === 'identify'), 'identified again', 10_000);
    await page.waitForTimeout(300);
    expect(Object.keys(roster.players)).toEqual([anaId]);
    expect(roster.players[anaId ?? '']?.name).toBe('Ana');
  }, 60_000);
});
