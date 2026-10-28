import { describe, expect, it } from 'vitest';
import {
  booksOf, compendiumEntries, entryMatches, groupCounts, newEntryText, type CompendiumBook, type EntryFilter,
} from '../../../src/app/compendium/compendiumEntries';
import type { InstalledSource } from '../../../src/app/compendium/installedSources';
import { parse } from 'yaml';
import { ID, ROOT } from './sourceZips';

const SRD: CompendiumBook = { id: ID, systemId: 'dnd5e-2014', systemName: 'D&D 5e 2014', name: 'SRD 5.1', root: ROOT };
const MINE: CompendiumBook = { id: 'dnd5e-2014/homebrew', systemId: 'dnd5e-2014', systemName: 'D&D 5e 2014', name: 'Homebrew', root: 'Compendium/D&D 5e 2014/Homebrew' };
const ALL: EntryFilter = { group: null, bookId: null, search: '' };

function installed(book: CompendiumBook): InstalledSource {
  const [systemId, bookId] = book.id.split('/') as [string, string];
  return {
    manifest: {
      format: 1, type: 'atlas-compendium-source', id: book.id, system: { id: systemId, name: book.systemName },
      book: { id: bookId, name: book.name }, version: 1, language: 'en', root: book.root,
    },
    installedAt: 1,
    files: {},
  };
}

describe('the compendium entries', () => {
  const notes = [
    { path: `${ROOT}/Spells/Fireball.md`, frontmatter: { 'atlas-compendium': 'spell', name: 'Fireball' } },
    { path: `${ROOT}/Monsters/Goblin.md`, frontmatter: { 'atlas-compendium': 'monster', name: 'Goblin' } },
    { path: `${ROOT}/Attribution.md`, frontmatter: { name: 'SRD 5.1 attribution' } },
    { path: `${MINE.root}/Monsters/Ash Wolf.md`, frontmatter: undefined },
    { path: `${MINE.root}/Monsters/Old Kind.md`, frontmatter: { 'atlas-compendium': 'dragon' } },
    { path: 'Compendium/D&D 5e 2014/SRD 5.1x/Spells/Elsewhere.md', frontmatter: { 'atlas-compendium': 'spell' } },
    { path: 'Notes/Fireball.md', frontmatter: { 'atlas-compendium': 'spell' } },
  ];

  it('lists the notes inside the books\' folders by name, with their kind and book', () => {
    expect(compendiumEntries([SRD, MINE], notes)).toEqual([
      { path: `${MINE.root}/Monsters/Ash Wolf.md`, name: 'Ash Wolf', group: 'other', bookId: MINE.id },
      { path: `${ROOT}/Spells/Fireball.md`, name: 'Fireball', group: 'spell', bookId: ID },
      { path: `${ROOT}/Monsters/Goblin.md`, name: 'Goblin', group: 'monster', bookId: ID },
      { path: `${MINE.root}/Monsters/Old Kind.md`, name: 'Old Kind', group: 'other', bookId: MINE.id },
      { path: `${ROOT}/Attribution.md`, name: 'SRD 5.1 attribution', group: 'other', bookId: ID },
    ]);
  });

  it('leaves out the books a campaign does not use', () => {
    expect(compendiumEntries([MINE], notes).map((entry) => entry.name)).toEqual(['Ash Wolf', 'Old Kind']);
  });

  it('takes a campaign\'s books from the installed ones, or every installed book without a campaign', () => {
    const vault = [installed(SRD), installed(MINE)];
    expect(booksOf(vault, [MINE.id, 'pf2e/core'])).toEqual([MINE]);
    expect(booksOf(vault, null)).toEqual([SRD, MINE]);
    expect(booksOf(vault, [])).toEqual([]);
  });

  it('filters by kind, book and any part of the name, and counts the kinds the other filters leave', () => {
    const entries = compendiumEntries([SRD, MINE], notes);
    expect(entries.filter((entry) => entryMatches(entry, { ...ALL, group: 'spell' })).map((entry) => entry.name)).toEqual(['Fireball']);
    expect(entries.filter((entry) => entryMatches(entry, { ...ALL, bookId: MINE.id })).map((entry) => entry.name)).toEqual(['Ash Wolf', 'Old Kind']);
    expect(entries.filter((entry) => entryMatches(entry, { ...ALL, search: '  BLIN ' })).map((entry) => entry.name)).toEqual(['Goblin']);
    expect(Object.fromEntries(groupCounts(entries, { ...ALL, group: 'spell', bookId: ID }))).toEqual({ spell: 1, monster: 1, other: 1 });
  });

  it('writes a new entry\'s kind, system, book and name as properties Obsidian reads', () => {
    const text = newEntryText(MINE, 'magic-item', 'Ring: "of" #3');
    expect(text.startsWith('---\n')).toBe(true);
    expect(text.endsWith('---\n')).toBe(true);
    expect(parse(text.slice(4, -4))).toEqual({
      'atlas-compendium': 'magic-item', 'atlas-system': 'dnd5e-2014', 'atlas-source': MINE.id, name: 'Ring: "of" #3',
    });
  });
});
