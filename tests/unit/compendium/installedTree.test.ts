import { describe, expect, it } from 'vitest';
import type { InstalledSource } from '../../../src/app/compendium/installedSources';
import type { OfficialSource } from '../../../src/app/compendium/officialSources';
import { installedTree, sourceTree } from '../../../src/app/compendium/sourceTree';

const official = (id: string, version = 1): OfficialSource => {
  const [system, book] = id.split('/') as [string, string];
  return { id, system: { id: system, name: system }, book: { id: book, name: book }, version, language: 'en', license: '', url: '', size: 1, sha256: '' };
};
const installed = (id: string, version = 1): InstalledSource => {
  const [system, book] = id.split('/') as [string, string];
  return { manifest: { format: 1, type: 'atlas-compendium-source', id, system: { id: system, name: system }, book: { id: book, name: book }, version, language: 'en', root: `Compendium/${system}/${book}` }, installedAt: 0, files: {} };
};
const ids = (tree: ReturnType<typeof installedTree>): string[][] => tree.map((system) => system.books.map((book) => book.id));

describe('the books a world chooses from', () => {
  it('are the installed books only, an outdated one and a personal one included', () => {
    const tree = sourceTree([official('a/one'), official('a/two', 2), official('b/three')], [installed('a/two'), installed('c/own')]);
    expect(ids(installedTree(tree))).toEqual([['a/two'], ['c/own']]);
    expect(installedTree(tree)[0]?.books[0]?.state.kind).toBe('outdated');
  });

  it('are none while the vault has installed nothing', () => {
    expect(installedTree(sourceTree([official('a/one')], []))).toEqual([]);
  });
});
