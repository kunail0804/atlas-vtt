import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import { CompendiumService } from '../../../src/app/compendium/CompendiumService';
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
