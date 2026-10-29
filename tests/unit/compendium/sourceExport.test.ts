import { describe, expect, it } from 'vitest';
import { CompendiumService } from '../../../src/app/compendium/CompendiumService';
import { installRecordPath } from '../../../src/app/compendium/installedSources';
import { personalManifest, slugOf, sourceFolderNames } from '../../../src/app/compendium/sourceExport';
import { installSource } from '../../../src/app/compendium/sourceInstall';
import { openSource } from '../../../src/app/compendium/sourceZip';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { memoryCompendiumVault } from './memoryCompendiumVault';
import { zipped } from './sourceZips';
import { sha256 } from '../../../src/app/utils/hashing';

const TASHA = 'Compendium/D&D 5e 2014/Tasha';

describe('exporting a personal source', () => {
  it('only exports a folder Compendium/<system>/<book>', () => {
    expect(sourceFolderNames(TASHA)).toEqual({ system: 'D&D 5e 2014', book: 'Tasha' });
    expect(sourceFolderNames('Compendium/D&D 5e 2014')).toBeNull();
    expect(sourceFolderNames(`${TASHA}/Spells`)).toBeNull();
    expect(sourceFolderNames('Notes/D&D 5e 2014/Tasha')).toBeNull();
    expect(slugOf("Tasha's Cauldron of Everything")).toBe('tasha-s-cauldron-of-everything');
    expect(slugOf('???')).toBe('source');
  });

  it('groups the book with an installed source of the same system, and raises its own version on every export', async () => {
    const vault = memoryCompendiumVault();
    await installSource(vault, await openSource(await zipped(1, { 'Compendium/D&D 5e 2014/SRD 5.1/A.md': 'a' })));
    const installed = [JSON.parse(vault.files.get(installRecordPath('dnd5e-2014/srd-5.1')) ?? '{}')];
    const first = personalManifest({ system: 'D&D 5e 2014', book: 'Tasha' }, [], installed);
    expect(first).toMatchObject({ id: 'dnd5e-2014/tasha', version: 1, root: TASHA });
    const again = personalManifest({ system: 'D&D 5e 2014', book: 'Tasha' }, [], [...installed, { manifest: first, installedAt: 1, files: {} }]);
    expect(again.version).toBe(2);
    expect(personalManifest({ system: 'Homebrew', book: 'My Book' }, [], installed).id).toBe('homebrew/my-book');
  });

  it('zips the folder, records it as installed here, and the zip installs in another vault', async () => {
    const { app, files } = createInMemoryApp({ files: { [`${TASHA}/Spells/Mind Sliver.md`]: 'sliver', [`${TASHA}/Feats/Fey Touched.md`]: 'fey', 'Notes/Other.md': 'x' } });
    const service = CompendiumService.forApp(app);
    const exported = await service.exportFolder(TASHA);
    expect(exported.fileName).toBe('d-d-5e-2014__tasha-v1.zip');
    expect(exported.manifest.files.map((file) => file.path)).toEqual([`${TASHA}/Feats/Fey Touched.md`, `${TASHA}/Spells/Mind Sliver.md`]);
    expect(files.has(installRecordPath('d-d-5e-2014/tasha'))).toBe(true);
    expect((await service.installed()).map((source) => source.manifest.book.name)).toEqual(['Tasha']);

    const other = memoryCompendiumVault();
    // jsdom's Blob has no arrayBuffer(); FileReader reads it as Obsidian's would.
    const data = await new Promise<ArrayBuffer>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.readAsArrayBuffer(exported.zip);
    });
    await installSource(other, await openSource(data));
    expect(other.files.get(`${TASHA}/Spells/Mind Sliver.md`)).toBe('sliver');
  });

  it('refuses a folder that is not a source, an empty one, and one of Atlas\' own sources', async () => {
    const { app } = createInMemoryApp({ folders: ['Compendium/Empty/Book'] });
    const service = CompendiumService.forApp(app);
    const srd = await zipped(1, { 'Compendium/D&D 5e 2014/SRD 5.1/A.md': 'a' });
    await service.installFile({ arrayBuffer: async () => srd });
    await expect(service.exportFolder('Compendium/D&D 5e 2014')).rejects.toThrow(/Only a folder/);
    await expect(service.exportFolder('Compendium/Empty/Book')).rejects.toThrow(/no notes/);
    await expect(service.exportFolder('Compendium/D&D 5e 2014/SRD 5.1')).rejects.toThrow(/one of Atlas' sources/);
  });

  it('refuses the Personal book, a folder whose id another book has, and a zip of another vault\'s Personal book', async () => {
    const { app } = createInMemoryApp({ files: {
      'Compendium/D&D 5e 2014/Personal/Spells/Mine.md': 'mine',
      'Compendium/Homebrew/My Book/A.md': 'a',
      'Compendium/Homebrew/My-Book/B.md': 'b',
    } });
    const service = CompendiumService.forApp(app);
    await expect(service.exportFolder('Compendium/D&D 5e 2014/Personal')).rejects.toThrow(/cannot be exported/);
    await service.exportFolder('Compendium/Homebrew/My Book');
    await expect(service.exportFolder('Compendium/Homebrew/My-Book')).rejects.toThrow(/has the id homebrew\/my-book already/);
    const path = 'Compendium/D&D 5e 2014/Personal/Spells/Theirs.md';
    const manifest = {
      format: 1, type: 'atlas-compendium-source', id: 'dnd5e-2014/personal', system: { id: 'dnd5e-2014', name: 'D&D 5e 2014' },
      book: { id: 'personal', name: 'Personal' }, version: 1, language: 'en', root: 'Compendium/D&D 5e 2014/Personal',
      files: [{ path, sha256: await sha256(new TextEncoder().encode('theirs')) }],
    };
    const theirs = await zipped(1, {}, (zip) => {
      zip.file('manifest.json', JSON.stringify(manifest));
      zip.file(`files/${path}`, 'theirs');
    });
    await expect(service.installFile({ arrayBuffer: async () => theirs })).rejects.toThrow(/cannot be installed/);
  });
});

