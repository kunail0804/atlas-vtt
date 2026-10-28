import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { CompendiumService } from '../../../src/app/compendium/CompendiumService';
import { compendiumEntries } from '../../../src/app/compendium/compendiumEntries';
import { installRecordPath } from '../../../src/app/compendium/installedSources';
import type { OfficialSource } from '../../../src/app/compendium/officialSources';
import { sha256 } from '../../../src/app/utils/hashing';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { at, ID, ROOT, zipped } from './sourceZips';

vi.mock('obsidian', async (importOriginal) => ({ ...(await importOriginal<typeof import('obsidian')>()), requestUrl: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

async function official(data: ArrayBuffer): Promise<OfficialSource> {
  return {
    id: ID, system: { id: 'dnd5e-2014', name: 'D&D 5e 2014' }, book: { id: 'srd-5.1', name: 'SRD 5.1' }, version: 1, language: 'en',
    license: 'CC BY 4.0', url: 'https://example.org/srd.zip', size: data.byteLength, sha256: await sha256(data),
  };
}

describe('the vault\'s compendium', () => {
  it('installs a zip file into the vault, lists it, and removes it with its emptied folders', async () => {
    const { app, files } = createInMemoryApp();
    const service = CompendiumService.forApp(app);
    const changes = vi.fn();
    service.onChange(changes);

    const data = await zipped(1, { [at('Spells/Fireball.md')]: 'fire', [at('Monsters/Goblin.md')]: 'gob' });
    const result = await service.installFile({ arrayBuffer: async () => data });
    expect(result).toMatchObject({ id: ID, written: 2 });
    expect(files.get(at('Spells/Fireball.md'))).toBe('fire');
    expect((await service.installed()).map((source) => source.manifest.id)).toEqual([ID]);
    expect(changes).toHaveBeenCalledTimes(1);

    expect(await service.remove(ID)).toEqual({ removed: 2, kept: [] });
    expect([...files.keys()].filter((path) => path.startsWith('Compendium/') || path === installRecordPath(ID))).toEqual([]);
    expect(app.vault.getFolderByPath(ROOT)).toBeNull();
    expect(app.vault.getFolderByPath('Compendium/D&D 5e 2014')).toBeNull();
    expect(app.vault.getFolderByPath('Compendium')).not.toBeNull();
    expect(await service.installed()).toEqual([]);
  });

  it('keeps the rule set folder while another of its books is there', async () => {
    const { app, folders } = createInMemoryApp({ files: { 'Compendium/D&D 5e 2014/Homebrew/Mine.md': 'mine' } });
    folders.add('Compendium').add('Compendium/D&D 5e 2014').add('Compendium/D&D 5e 2014/Homebrew');
    const service = CompendiumService.forApp(app);
    await service.installFile({ arrayBuffer: async () => zipped(1, { [at('A.md')]: 'a' }) });

    await service.remove(ID);
    expect(app.vault.getFolderByPath(ROOT)).toBeNull();
    expect(app.vault.getFolderByPath('Compendium/D&D 5e 2014')).not.toBeNull();
  });

  it('trashes a folder an update emptied', async () => {
    const { app, files } = createInMemoryApp();
    const service = CompendiumService.forApp(app);
    await service.installFile({ arrayBuffer: async () => zipped(1, { [at('Spells/Fireball.md')]: 'fire', [at('Monsters/Goblin.md')]: 'gob' }) });

    expect(await service.installFile({ arrayBuffer: async () => zipped(2, { [at('Spells/Fireball.md')]: 'fire' }) })).toMatchObject({ written: 0, removed: 1 });
    expect(files.has(at('Monsters/Goblin.md'))).toBe(false);
    expect(app.vault.getFolderByPath(at('Monsters'))).toBeNull();
    expect(app.vault.getFolderByPath(at('Spells'))).not.toBeNull();
  });

  it('installs a source of Atlas\' list only when the download matches its size and SHA-256', async () => {
    const { app, files } = createInMemoryApp();
    const service = CompendiumService.forApp(app);
    const data = await zipped(1, { [at('A.md')]: 'a' });
    const listed = await official(data);

    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 200, arrayBuffer: await zipped(1, { [at('A.md')]: 'other' }) } as never);
    await expect(service.installOfficial(listed)).rejects.toThrow(/does not match/);
    expect(files.has(at('A.md'))).toBe(false);

    // The right bytes against a list that names another size, then another SHA-256 of the same size.
    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 200, arrayBuffer: data } as never);
    await expect(service.installOfficial({ ...listed, size: listed.size + 1 })).rejects.toThrow(/does not match/);
    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 200, arrayBuffer: data } as never);
    await expect(service.installOfficial({ ...listed, sha256: '0'.repeat(64) })).rejects.toThrow(/does not match/);
    expect(files.has(at('A.md'))).toBe(false);

    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 404, arrayBuffer: new ArrayBuffer(0) } as never);
    await expect(service.installOfficial(listed)).rejects.toThrow(/HTTP 404/);

    vi.mocked(requestUrl).mockResolvedValueOnce({ status: 200, arrayBuffer: data } as never);
    await expect(service.installOfficial(listed)).resolves.toMatchObject({ written: 1 });
    expect(files.get(at('A.md'))).toBe('a');
    expect(vi.mocked(requestUrl)).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://example.org/srd.zip', method: 'GET' }));
  });
});

describe('the GM\'s own books and entries', () => {
  const HOMEBREW = 'Compendium/D&D 5e 2014/Homebrew';

  it('makes an empty book in the system of an installed source and records it, so campaigns can choose it', async () => {
    const { app, files } = createInMemoryApp();
    const service = CompendiumService.forApp(app);
    await service.installFile({ arrayBuffer: async () => zipped(1, { [at('A.md')]: 'a' }) });
    const changes = vi.fn();
    service.onChange(changes);

    const id = await service.createBook(' D&D 5e 2014 ', 'Homebrew');
    expect(id).toBe('dnd5e-2014/homebrew');
    expect(app.vault.getFolderByPath(HOMEBREW)).not.toBeNull();
    const record = JSON.parse(files.get(installRecordPath(id)) ?? 'null');
    expect(record.manifest).toMatchObject({ id, system: { id: 'dnd5e-2014', name: 'D&D 5e 2014' }, book: { id: 'homebrew', name: 'Homebrew' }, version: 1, root: HOMEBREW });
    expect(record.files).toEqual({});
    expect((await service.installed()).map((source) => source.manifest.id)).toEqual([id, ID]);
    expect(changes).toHaveBeenCalledTimes(1);

    await expect(service.createBook('D&D 5e 2014', 'Homebrew')).rejects.toThrow('already has a book named Homebrew');
    await expect(service.createBook('D&D 5e 2014', 'SRD 5.1')).rejects.toThrow('already has a book named SRD 5.1');
    await expect(service.createBook('D&D 5e 2014', 'Bad/Name')).rejects.toThrow('A name may not');
  });

  it('removes nothing the GM wrote when their book is removed', async () => {
    const { app, files } = createInMemoryApp();
    const service = CompendiumService.forApp(app);
    const id = await service.createBook('Shadowdark', 'Mine');
    const book = { id, systemId: 'shadowdark', systemName: 'Shadowdark', name: 'Mine', root: 'Compendium/Shadowdark/Mine' };
    const file = await service.createEntry(book, 'spell', 'Light');
    await service.remove(id);
    expect(files.has(file.path)).toBe(true);
    expect(files.has(installRecordPath(id))).toBe(false);
  });

  it('writes an entry into its kind\'s folder of the book, beside one of the same name', async () => {
    const { app, files } = createInMemoryApp();
    const service = CompendiumService.forApp(app);
    const book = { id: 'pf2e/mine', systemId: 'pf2e', systemName: 'Pathfinder 2e', name: 'Mine', root: 'Compendium/Pathfinder 2e/Mine' };

    const first = await service.createEntry(book, 'magic-item', 'Ring of Ash');
    const second = await service.createEntry(book, 'magic-item', 'Ring of Ash');
    expect(first.path).toBe('Compendium/Pathfinder 2e/Mine/Magic Items/Ring of Ash.md');
    expect(second.path).toBe('Compendium/Pathfinder 2e/Mine/Magic Items/Ring of Ash 2.md');
    expect(files.get(first.path)).toBe('---\natlas-compendium: magic-item\natlas-system: pf2e\natlas-source: pf2e/mine\nname: Ring of Ash\n---\n');
  });

  it('makes a monster of a system with a built-in monster template a native statblock of that template', async () => {
    const { app, files } = createInMemoryApp();
    const service = CompendiumService.forApp(app);
    const book = { id: 'dnd5e-2024/mine', systemId: 'dnd5e-2024', systemName: 'D&D 5e 2024', name: 'Mine', root: 'Compendium/D&D 5e 2024/Mine' };

    const file = await service.createEntry(book, 'monster', 'Ash Wolf');
    expect(file.path).toBe('Compendium/D&D 5e 2024/Mine/Monsters/Ash Wolf.md');
    const text = files.get(file.path) ?? '';
    expect(text).toContain('statblock: true');
    expect(text).toContain('atlas-template: builtin:5e-2024-monster');
    expect(text).toContain('name: Ash Wolf');
    expect(text).toContain('atlas-compendium: monster');
    expect(text).toContain('atlas-source: dnd5e-2024/mine');

    const other = await service.createEntry({ ...book, id: 'pf2e/mine', systemId: 'pf2e', root: 'Compendium/Pathfinder 2e/Mine' }, 'monster', 'Ash Wolf');
    expect(files.get(other.path)).not.toContain('statblock');
  });
});

describe('the file name of a new entry', () => {
  it('is one the compendium lists, whatever the name, and the name stays whole in the note', async () => {
    const { app, files } = createInMemoryApp();
    const service = CompendiumService.forApp(app);
    const book = { id: 'dnd5e-2024/mine', systemId: 'dnd5e-2024', systemName: 'D&D 5e 2024', name: 'Mine', root: 'Compendium/D&D 5e 2024/Mine' };
    const long = 'a'.repeat(300);
    const made = [
      await service.createEntry(book, 'spell', long),
      await service.createEntry(book, 'spell', 'Tab\tName'),
      await service.createEntry(book, 'monster', `${long} wolf`),
      await service.createEntry(book, 'spell', '...'),
    ];
    const notes = made.map((file) => ({ path: file.path, frontmatter: undefined }));
    expect(compendiumEntries([book], notes)).toHaveLength(4);
    expect(made[1]?.path).toBe('Compendium/D&D 5e 2024/Mine/Spells/Tab Name.md');
    expect(made[3]?.path).toBe('Compendium/D&D 5e 2024/Mine/Spells/Untitled.md');
    expect(files.get(made[0]?.path ?? '')).toContain(`name: ${long}`);
    expect(files.get(made[2]?.path ?? '')).toContain(`name: ${long} wolf`);
  });
});
