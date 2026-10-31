// @vitest-environment node
import { TFile, type App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { applySheetPick } from '../../../src/app/characterSheets/obsidian/sheetPick.ts';
import { DND5E_2024 } from '../../../src/app/characterSheets/dnd5e2024.ts';
import { newSheet, sheetFrontmatter } from '../../../src/app/characterSheets/sheetNote.ts';

const SHEET = 'Personnages/Mira.md';
const ENTRIES: Record<string, string> = {
  'Compendium/X/Classes/Wizard.md': '---\natlas-compendium: class\nname: Wizard\nhit-die: d6\n---\nArcane.\n',
  'Compendium/X/Equipment/Dagger.md': '---\natlas-compendium: item\nname: Dagger\nitem-type: weapon\nweapon-category: Simple Melee\ndamage: 1d4\ndamage-type: Piercing\nproperties: [Finesse, Light]\n---\n',
};

/** Mira's sheet and two compendium entries; the sheet's text is its frontmatter as JSON (which is YAML). */
function vault(): { app: App; frontmatter: () => Record<string, unknown> } {
  const state = { frontmatter: { ...sheetFrontmatter(DND5E_2024, { ...newSheet(DND5E_2024, 'Mira'), stats: [8, 14, 10, 16, 10, 10] }) } as Record<string, unknown> };
  const sheet = new TFile(SHEET);
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => (path === SHEET ? sheet : null),
      getFileByPath: (path: string) => (path in ENTRIES ? new TFile(path) : null),
      read: async () => `---\n${JSON.stringify(state.frontmatter)}\n---\n`,
      cachedRead: async (file: TFile) => ENTRIES[file.path] ?? '',
    },
    fileManager: {
      processFrontMatter: async (_file: TFile, change: (frontmatter: Record<string, unknown>) => void) => { change(state.frontmatter); },
    },
  } as unknown as App;
  return { app, frontmatter: () => state.frontmatter };
}

describe('taking a compendium entry into a sheet\'s note', () => {
  it('writes a class and its follow-ups, and a weapon as an attack, saying the book had no place without online play', async () => {
    const note = vault();
    expect(await applySheetPick(note.app, SHEET, 'class', 'Compendium/X/Classes/Wizard.md')).toEqual({ sheet: true, book: null });
    expect(note.frontmatter()).toMatchObject({ classes: [{ name: 'Wizard', level: 1, die: 'd6' }], class: 'Wizard', level: 1, 'hit-dice': '1d6' });
    expect(await applySheetPick(note.app, SHEET, 'weapon', 'Compendium/X/Equipment/Dagger.md')).toEqual({ sheet: true, book: false });
    expect(note.frontmatter().attacks).toEqual([{ name: 'Dagger', bonus: '+4', damage: '1d4+2 piercing', notes: 'Finesse, Light' }]);
    // Fantasy Statblocks' actions follow the attacks, as for any edit.
    expect(note.frontmatter().actions).toEqual([{ name: 'Dagger', desc: '+4 to hit, 1d4+2 piercing, Finesse, Light' }]);
  });

  it('takes nothing from an entry that is gone', async () => {
    const note = vault();
    expect(await applySheetPick(note.app, SHEET, 'class', 'Compendium/X/Classes/Gone.md')).toEqual({ sheet: false, book: null });
  });
});
