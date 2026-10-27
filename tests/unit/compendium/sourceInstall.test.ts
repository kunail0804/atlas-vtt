import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { at, ID, ROOT, zipped } from './sourceZips';
import { installRecordPath, parseInstalledSource } from '../../../src/app/compendium/installedSources';
import { installSource, readInstalledSource, removeSource } from '../../../src/app/compendium/sourceInstall';
import { openSource, type OpenedSource } from '../../../src/app/compendium/sourceZip';
import { memoryCompendiumVault } from './memoryCompendiumVault';

const source = async (version: number, files: Record<string, string>): Promise<OpenedSource> => openSource(await zipped(version, files));

describe('opening a source zip', () => {
  it('refuses a file that does not match its checksum, and a file that is no zip', async () => {
    const data = await zipped(1, { [at('A.md')]: 'a' }, (zip) => zip.file(`files/${at('A.md')}`, 'changed'));
    await expect(openSource(data)).rejects.toThrow(/does not match its checksum/);
    await expect(openSource(new TextEncoder().encode('not a zip').buffer)).rejects.toThrow(/not a readable zip/);
  });

  it('refuses a zip without a manifest', async () => {
    const zip = new JSZip();
    zip.file('files/x.md', 'x');
    await expect(openSource(await zip.generateAsync({ type: 'arraybuffer' }))).rejects.toThrow(/not an Atlas compendium source/);
  });
});

describe('installing a source', () => {
  it('writes every file, then a record of what it wrote', async () => {
    const vault = memoryCompendiumVault();
    const result = await installSource(vault, await source(1, { [at('A.md')]: 'a', [at('Spells/B.md')]: 'b' }), undefined, 42);
    expect(result).toMatchObject({ id: ID, name: 'SRD 5.1', written: 2, removed: 0, kept: [] });
    expect(vault.files.get(at('Spells/B.md'))).toBe('b');
    const record = await readInstalledSource(vault, ID);
    expect(record?.installedAt).toBe(42);
    expect(Object.keys(record?.files ?? {}).sort()).toEqual([at('A.md'), at('Spells/B.md')]);
    expect(vault.files.has(installRecordPath(ID))).toBe(true);
  });

  it('writes nothing when the same version is installed again', async () => {
    const vault = memoryCompendiumVault();
    const files = { [at('A.md')]: 'a' };
    await installSource(vault, await source(1, files));
    expect(await installSource(vault, await source(1, files))).toMatchObject({ written: 0, removed: 0, kept: [] });
  });

  it('updates what the GM left alone and keeps what the GM changed or deleted', async () => {
    const vault = memoryCompendiumVault();
    await installSource(vault, await source(1, {
      [at('Untouched.md')]: 'v1', [at('Edited.md')]: 'v1', [at('Deleted.md')]: 'v1', [at('Dropped.md')]: 'v1', [at('DroppedEdited.md')]: 'v1',
    }));
    vault.files.set(at('Edited.md'), 'my notes');
    vault.files.set(at('DroppedEdited.md'), 'my notes');
    vault.files.delete(at('Deleted.md'));

    const result = await installSource(vault, await source(2, {
      [at('Untouched.md')]: 'v2', [at('Edited.md')]: 'v2', [at('Deleted.md')]: 'v2', [at('New.md')]: 'v2',
    }));

    expect(vault.files.get(at('Untouched.md'))).toBe('v2');
    expect(vault.files.get(at('New.md'))).toBe('v2');
    expect(vault.files.get(at('Edited.md'))).toBe('my notes');
    expect(vault.files.has(at('Deleted.md'))).toBe(false);
    expect(vault.files.has(at('Dropped.md'))).toBe(false);
    expect(vault.files.get(at('DroppedEdited.md'))).toBe('my notes');
    expect(vault.trashed).toEqual([at('Dropped.md')]);
    expect(result.kept.sort()).toEqual([at('Deleted.md'), at('DroppedEdited.md'), at('Edited.md')]);
    expect((await readInstalledSource(vault, ID))?.manifest.version).toBe(2);
  });

  it('never overwrites a note of the GM that already sat where the source puts one', async () => {
    const vault = memoryCompendiumVault({ [at('A.md')]: 'my own note' });
    const result = await installSource(vault, await source(1, { [at('A.md')]: 'source text' }));
    expect(vault.files.get(at('A.md'))).toBe('my own note');
    expect(result.kept).toEqual([at('A.md')]);
  });
});

describe('removing a source', () => {
  it('trashes the files the GM left as installed, keeps the changed ones, and forgets the install', async () => {
    const vault = memoryCompendiumVault();
    await installSource(vault, await source(1, { [at('A.md')]: 'a', [at('B.md')]: 'b' }));
    vault.files.set(at('B.md'), 'my notes');
    const record = await readInstalledSource(vault, ID);
    if (!record) throw new Error('not installed');

    expect(await removeSource(vault, record)).toEqual({ removed: 1, kept: [at('B.md')] });
    expect(vault.files.has(at('A.md'))).toBe(false);
    expect(vault.files.get(at('B.md'))).toBe('my notes');
    expect(vault.files.has(installRecordPath(ID))).toBe(false);
  });
});

describe('install records', () => {
  it('reads back what an install wrote and refuses anything else', async () => {
    const vault = memoryCompendiumVault();
    await installSource(vault, await source(1, { [at('A.md')]: 'a' }));
    const text = vault.files.get(installRecordPath(ID)) ?? '';
    expect(parseInstalledSource(text)?.manifest.id).toBe(ID);
    expect(parseInstalledSource('{')).toBeNull();
    expect(parseInstalledSource(JSON.stringify({ manifest: { id: 'x' }, files: {}, installedAt: 1 }))).toBeNull();
  });

  it('ignores a recorded file outside the source folder, so removing the source never trashes it', async () => {
    const vault = memoryCompendiumVault({ 'Notes/Mine.md': 'mine' });
    await installSource(vault, await source(1, { [at('A.md')]: 'a' }));
    const stored = JSON.parse(vault.files.get(installRecordPath(ID)) ?? '{}') as { files: Record<string, unknown> };
    const mine = await vault.fingerprint('Notes/Mine.md');
    stored.files['Notes/Mine.md'] = { sha256: mine };
    stored.files[`${ROOT}/../Mine.md`] = { sha256: mine };
    const record = parseInstalledSource(JSON.stringify(stored));
    if (!record) throw new Error('not read');

    expect(Object.keys(record.files)).toEqual([at('A.md')]);
    expect(await removeSource(vault, record)).toEqual({ removed: 1, kept: [] });
    expect(vault.files.get('Notes/Mine.md')).toBe('mine');
  });
});
