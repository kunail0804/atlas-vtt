import { describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import { playerNoteFiles } from '../../../../src/app/sheets/playerNotes';

const BARBARIAN = 'Compendium/D&D 5e 2014/SRD 5.1/Classes/Barbarian.md';
const DIARY = 'Players/Mira diary.md';

/** A vault of two notes: a compendium class and a plain note, found by name as Obsidian resolves a link. */
function vault(): App {
  const files = new Map([BARBARIAN, DIARY].map((path) => [path, new TFile(path)]));
  const frontmatter: Record<string, Record<string, unknown>> = { [BARBARIAN]: { 'atlas-compendium': 'class', name: 'Barbarian' }, [DIARY]: { tags: ['diary'] } };
  return {
    metadataCache: {
      getFirstLinkpathDest: (link: string) => [...files.values()].find((file) => file.path === link || file.basename === link) ?? null,
      getFileCache: (file: TFile) => ({ frontmatter: frontmatter[file.path] }),
    },
    vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null },
  } as unknown as App;
}

describe('the notes a sheet links for its player', () => {
  it('reads a linked compendium entry as a compendium page and any other note as a document', () => {
    const notes = playerNoteFiles(vault(), ['[[Barbarian]]', '[[Mira diary|Diary]]', '[[Gone]]'], 'Players/Mira.md');
    expect(notes.entries.map((file) => file.path)).toEqual([BARBARIAN]);
    expect(notes.documents.map((file) => file.path)).toEqual([DIARY]);
  });
});
