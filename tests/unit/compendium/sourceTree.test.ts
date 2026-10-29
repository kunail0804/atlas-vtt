import { describe, expect, it } from 'vitest';
import type { InstalledSource } from '../../../src/app/compendium/installedSources';
import type { OfficialSource } from '../../../src/app/compendium/officialSources';
import { booksToMake, downloadsFor, sourceTree, systemSelection, toggleBook, toggleSystem } from '../../../src/app/compendium/sourceTree';

const official = (system: string, book: string, version = 1): OfficialSource => ({
  id: `${system}/${book}`, system: { id: system, name: system.toUpperCase() }, book: { id: book, name: book.toUpperCase() },
  version, language: 'en', license: 'CC BY 4.0', url: `https://example.org/${book}.zip`, size: 10, sha256: 'a'.repeat(64),
});

const installed = (system: string, book: string, version = 1): InstalledSource => ({
  manifest: {
    format: 1, type: 'atlas-compendium-source', id: `${system}/${book}`, system: { id: system, name: system.toUpperCase() },
    book: { id: book, name: book.toUpperCase() }, version, language: 'en', root: `Compendium/${system.toUpperCase()}/${book.toUpperCase()}`,
  },
  installedAt: 1,
  files: {},
});

describe('the source picker tree', () => {
  const OFFICIAL = [official('dnd5e-2014', 'srd-5.1', 2), official('dnd5e-2024', 'srd-5.2.1')];

  it('groups books under their game system, with where each stands in the vault', () => {
    const tree = sourceTree(OFFICIAL, [installed('dnd5e-2014', 'srd-5.1', 1), installed('dnd5e-2014', 'tasha')]);
    expect(tree.map((system) => [system.id, system.books.map((book) => [book.id, book.personal, book.state.kind])])).toEqual([
      ['dnd5e-2014', [['dnd5e-2014/srd-5.1', false, 'outdated'], ['dnd5e-2014/tasha', true, 'installed'], ['dnd5e-2014/personal', true, 'new']]],
      ['dnd5e-2024', [['dnd5e-2024/srd-5.2.1', false, 'available'], ['dnd5e-2024/personal', true, 'new']]],
    ]);
  });

  it('ticks a whole system, unticks it once all are ticked, and half-ticks it for some', () => {
    const [system] = sourceTree(OFFICIAL, [installed('dnd5e-2014', 'tasha')]);
    if (!system) throw new Error('no system');
    expect(systemSelection(system, new Set())).toBe('none');
    const some = new Set(['dnd5e-2014/tasha']);
    expect(systemSelection(system, some)).toBe('some');
    const all = toggleSystem(system, some);
    expect(systemSelection(system, all)).toBe('all');
    expect([...toggleSystem(system, all)]).toEqual([]);
  });

  it('downloads only the chosen books the vault lacks or has in an older version', () => {
    const tree = sourceTree(OFFICIAL, [installed('dnd5e-2014', 'srd-5.1', 2)]);
    expect(downloadsFor(tree, new Set(['dnd5e-2014/srd-5.1', 'dnd5e-2024/srd-5.2.1'])).map((source) => source.id)).toEqual(['dnd5e-2024/srd-5.2.1']);
    expect(downloadsFor(sourceTree(OFFICIAL, [installed('dnd5e-2014', 'srd-5.1', 1)]), new Set(['dnd5e-2014/srd-5.1'])).map((source) => source.id)).toEqual(['dnd5e-2014/srd-5.1']);
  });

  it('ticks a system\'s personal book with its first book, and lets the GM untick it', () => {
    const [system] = sourceTree(OFFICIAL, []);
    if (!system) throw new Error('no system');
    const first = toggleBook(system, 'dnd5e-2014/srd-5.1', new Set());
    expect([...first].sort()).toEqual(['dnd5e-2014/personal', 'dnd5e-2014/srd-5.1']);
    const untick = toggleBook(system, 'dnd5e-2014/personal', first);
    expect([...untick]).toEqual(['dnd5e-2014/srd-5.1']);
    // Not the first book any more: the personal book stays as the GM left it.
    expect([...toggleBook(system, 'dnd5e-2014/tasha', untick)].sort()).toEqual(['dnd5e-2014/srd-5.1', 'dnd5e-2014/tasha']);
  });

  it('makes a chosen personal book once, and knows one the vault has', () => {
    const tree = sourceTree(OFFICIAL, [installed('dnd5e-2024', 'personal')], 'Perso');
    const chosen = new Set(['dnd5e-2014/personal', 'dnd5e-2024/personal']);
    expect(booksToMake(tree, chosen)).toEqual([{ system: { id: 'dnd5e-2014', name: 'DND5E-2014' }, book: { id: 'personal', name: 'Perso' } }]);
    const own = tree.flatMap((system) => system.books).filter((book) => book.ownBook === true).map((book) => [book.id, book.state.kind]);
    expect(own).toEqual([['dnd5e-2014/personal', 'new'], ['dnd5e-2024/personal', 'installed']]);
  });
});
