import { describe, expect, it } from 'vitest';
import { isSourceId, sourceManifestProblem, type CompendiumSourceManifest } from '../../../src/app/compendium/sourceFormat';

const HASH = 'a'.repeat(64);

function manifest(changes: Partial<CompendiumSourceManifest> = {}): CompendiumSourceManifest {
  return {
    format: 1,
    type: 'atlas-compendium-source',
    id: 'dnd5e-2014/srd-5.1',
    system: { id: 'dnd5e-2014', name: 'D&D 5e 2014' },
    book: { id: 'srd-5.1', name: 'SRD 5.1' },
    version: 1,
    language: 'en',
    root: 'Compendium/D&D 5e 2014/SRD 5.1',
    files: [{ path: 'Compendium/D&D 5e 2014/SRD 5.1/Spells/Fireball.md', sha256: HASH }],
    ...changes,
  };
}

describe('compendium source manifests', () => {
  it('accepts a source whose files all lie in its own folder', () => {
    expect(sourceManifestProblem(manifest())).toBeNull();
  });

  it('refuses a file outside the source folder, through .., in a hidden folder, or twice in any letter case', () => {
    const file = (path: string): CompendiumSourceManifest['files'][number] => ({ path, sha256: HASH });
    expect(sourceManifestProblem(manifest({ files: [file('Notes/Fireball.md')] }))).toMatch(/outside its folder/);
    expect(sourceManifestProblem(manifest({ files: [file('Compendium/D&D 5e 2014/SRD 5.1/../../../x.md')] }))).toMatch(/outside its folder/);
    expect(sourceManifestProblem(manifest({ files: [file('Compendium/D&D 5e 2014/SRD 5.1/.obsidian/app.json')] }))).toMatch(/outside its folder/);
    expect(sourceManifestProblem(manifest({ files: [file('Compendium/D&D 5e 2014/SRD 5.1')] }))).toMatch(/outside its folder/);
    expect(sourceManifestProblem(manifest({
      files: [file('Compendium/D&D 5e 2014/SRD 5.1/Spells/Fireball.md'), file('Compendium/D&D 5e 2014/SRD 5.1/spells/fireball.md')],
    }))).toMatch(/same file twice/);
  });

  it('refuses a manifest whose id, root, version or format does not hold', () => {
    expect(sourceManifestProblem(manifest({ id: 'dnd5e-2014/other' }))).toMatch(/id does not match/);
    expect(sourceManifestProblem(manifest({ root: 'Compendium/Elsewhere' }))).toMatch(/own folder/);
    expect(sourceManifestProblem(manifest({ version: 0 }))).toMatch(/version/);
    expect(sourceManifestProblem(manifest({ format: 2 }))).toMatch(/newer version/);
    expect(sourceManifestProblem({ ...manifest(), type: 'atlas-collection' })).toMatch(/not an Atlas compendium source/);
    expect(sourceManifestProblem(manifest({ book: { id: 'srd-5.1', name: 'SRD/5.1' } }))).toMatch(/names its game system or book wrongly/);
    expect(sourceManifestProblem(manifest({ files: [{ path: 'Compendium/D&D 5e 2014/SRD 5.1/a.md', sha256: 'nope' }] }))).toMatch(/damaged/);
  });

  it('knows a source id: two lower-case labels joined by a slash', () => {
    expect(isSourceId('dnd5e-2024/srd-5.2.1')).toBe(true);
    expect(isSourceId('dnd5e-2024')).toBe(false);
    expect(isSourceId('a/b/c')).toBe(false);
    expect(isSourceId('DnD/Srd')).toBe(false);
    expect(isSourceId(7)).toBe(false);
  });
});
