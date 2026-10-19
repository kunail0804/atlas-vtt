// @vitest-environment node
import { TFile, type App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { editSheetFile, linkedNote, readSheetFile, setPlayerNotes, setSheetSystem } from '../../../src/app/characterSheets/obsidian/sheetFiles.ts';
import { DND5E_2024 } from '../../../src/app/characterSheets/dnd5e2024.ts';
import { newSheet, sheetFrontmatter } from '../../../src/app/characterSheets/sheetNote.ts';

/**
 * A vault of two notes: Mira's sheet and a lore note. A note is its frontmatter and body; its text is
 * the frontmatter as JSON (which is YAML) between the fences, as Obsidian would read it.
 */
function vault(): { app: App; sheet: TFile; lore: TFile; frontmatter: Record<string, unknown>; writes: number } {
  const sheet = new TFile('Personnages/Mira.md');
  const lore = new TFile('Lore/Famille.md');
  const state = { frontmatter: { ...sheetFrontmatter(DND5E_2024, { ...newSheet(DND5E_2024, 'Mira'), level: 2 }), image: 'art/mira.webp', custom: 'gardé' } as Record<string, unknown>, writes: 0 };
  const app = {
    vault: { getAbstractFileByPath: () => null, read: async (file: TFile) => (file === sheet ? `---\n${JSON.stringify(state.frontmatter)}\n---\nCorps de la note\n` : '# Famille\n') },
    fileManager: {
      processFrontMatter: async (_file: TFile, change: (frontmatter: Record<string, unknown>) => void) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        state.writes += 1;
        change(state.frontmatter);
      },
    },
    metadataCache: { getFirstLinkpathDest: (link: string) => (link === 'Famille' || link === 'Lore/Famille' ? lore : null) },
  } as unknown as App;
  return { app, sheet, lore, get frontmatter() { return state.frontmatter; }, get writes() { return state.writes; } };
}

describe('a character sheet\'s note', () => {
  it('is read as its sheet, and an edit is written beside every other key, one write after another', async () => {
    const note = vault();
    expect((await readSheetFile(note.app, note.sheet))?.values.level).toBe(2);
    const [first, second, refused] = await Promise.all([
      editSheetFile(note.app, note.sheet, { op: 'set', key: 'level', value: 3 }),
      editSheetFile(note.app, note.sheet, { op: 'row', key: 'attacks', index: 0, row: { name: 'Dague', damage: '1d4+3' } }),
      editSheetFile(note.app, note.sheet, { op: 'set', key: 'level', value: 30 }),
    ]);
    expect(first?.values.level).toBe(3);
    // The second edit was applied to what the first wrote.
    expect(second?.values.level).toBe(3);
    expect(refused).toBeNull();
    expect(note.writes).toBe(2);
    expect(note.frontmatter).toMatchObject({ level: 3, attacks: [{ name: 'Dague', bonus: '', damage: '1d4+3', notes: '' }], image: 'art/mira.webp', custom: 'gardé', statblock: true, 'atlas-sheet': 'dnd5e-2024' });
  });

  it('goes under the 2014 rules and back with every value kept, and refuses a system it does not know', async () => {
    const note = vault();
    await editSheetFile(note.app, note.sheet, { op: 'set', key: 'class', value: 'Roublarde' });
    expect((await setSheetSystem(note.app, note.sheet, 'dnd5e-2014'))?.system.id).toBe('dnd5e-2014');
    expect(note.frontmatter).toMatchObject({ 'atlas-sheet': 'dnd5e-2014', class: 'Roublarde', level: 2, image: 'art/mira.webp', custom: 'gardé' });
    expect(await setSheetSystem(note.app, note.sheet, 'pathfinder')).toBeNull();
    expect((await setSheetSystem(note.app, note.sheet, 'dnd5e-2024'))?.values.class).toBe('Roublarde');
    expect(note.frontmatter['atlas-sheet']).toBe('dnd5e-2024');
  });

  it('keeps the notes linked for its player, each once', async () => {
    const note = vault();
    await setPlayerNotes(note.app, note.sheet, ['[[Famille]]', '[[Famille]]']);
    expect(note.frontmatter['atlas-player-notes']).toEqual(['[[Famille]]']);
    expect(linkedNote(note.app, '[[Famille|la famille]]', note.sheet.path)).toBe(note.lore);
    expect(linkedNote(note.app, '[[Inconnue]]', note.sheet.path)).toBeNull();
    await setPlayerNotes(note.app, note.sheet, []);
    expect(note.frontmatter).not.toHaveProperty('atlas-player-notes');
  });
});
