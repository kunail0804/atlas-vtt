import { describe, expect, it, vi } from 'vitest';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { ONLINE_DATA_PATH } from '../../../src/app/online/gm/onlineData';
import { obsidianWorldVault } from '../../../src/app/worldBackups/worldVault';
import { BACKUPS_FOLDER, BackupFolderError, type BackupFolder } from '../../../src/app/worldBackups/backupFolder';
import { backupFolderOf, saveBackupFolderPath, isInAtlasFolder } from '../../../src/app/worldBackups/backupLocation';
import type { NodeFiles } from '../../../src/app/soundLibrary/nodeFiles';
import { KEPT_SCHEDULED_BACKUPS, UnreadableBackupError, WorldBackups } from '../../../src/app/worldBackups/WorldBackups';
import { backupDue } from '../../../src/app/worldBackups/backupSchedule';
import { NewerSharesError, PageShares } from '../../../src/app/players/PageShares';
import { parseShares, SHARES_PATH } from '../../../src/app/players/shares';
import { backupName, isWorldDataPath, newestFirst } from '../../../src/app/worldBackups/worldBackupArchive';

const CAMPAIGN = 'atlas-vtt/campaigns/Greyhawk';
const ORIGINAL: Record<string, string> = {
  [ONLINE_DATA_PATH]: JSON.stringify({ reportErrors: false, table: { code: 'ABCDEFGH', secret: 's'.repeat(43), campaignId: 'c'.repeat(24) }, tableLog: { entries: [{ text: 'Hello' }] } }),
  [`${CAMPAIGN}/campaign.json`]: JSON.stringify({ format: 1, id: 'c'.repeat(24), name: 'Greyhawk', sources: ['dnd5e-2014/srd-5.1'] }, null, 2),
  [`${CAMPAIGN}/players.json`]: JSON.stringify({ format: 1, campaignId: 'c'.repeat(24), link: 'ABCDEFGH', players: { p1: { name: 'Ann', code: '123456', characters: [] } } }, null, 2),
  [`${CAMPAIGN}/books.json`]: JSON.stringify({ format: 1, campaignId: 'c'.repeat(24), books: {} }),
  'atlas-vtt/campaigns/Eberron/campaign.json': JSON.stringify({ format: 1, id: 'e'.repeat(24), name: 'Eberron' }),
};

/** A vault holding the original world data, the backups service over it, and a clock the test moves. */
function setup(files: Record<string, string> = ORIGINAL, disk: DiskFiles | null = null): { files: Map<string, string>; app: ReturnType<typeof createInMemoryApp>['app']; backups: WorldBackups; quiet: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn>; tick(ms?: number): void } {
  const memory = createInMemoryApp({ files: { ...files, 'atlas-vtt/.atlas-data/assets-metadata.json': '{}' } });
  let now = Date.UTC(2026, 10, 12, 20, 0, 0);
  const settle = vi.fn(async () => undefined);
  const quiet = vi.fn(<T>(work: () => Promise<T>): Promise<T> => work());
  const backups = new WorldBackups({ vault: obsidianWorldVault(memory.app), vaultId: 'vault-a', folder: () => backupFolderOf(memory.app, disk?.node ?? null, null), now: () => now, settle, quiet, reload: async () => undefined });
  return { files: memory.files, app: memory.app, backups, quiet, settle, tick: (ms = 1000) => void (now += ms) };
}

const nodeError = (code: string): Error => Object.assign(new Error(code), { code });

/** A disk outside the vault: folders that exist, files by absolute path, and folders that refuse writing. */
interface DiskFiles {
  readonly folders: Set<string>;
  readonly files: Map<string, string>;
  readonly readOnly: Set<string>;
  readonly node: NodeFiles;
}

function diskFiles(folders: string[]): DiskFiles {
  const disk = { folders: new Set(folders), files: new Map<string, string>(), readOnly: new Set<string>() };
  const parent = (path: string): string => path.slice(0, path.lastIndexOf('/'));
  const entry = (name: string, file: boolean): { name: string; isFile(): boolean; isDirectory(): boolean } => ({ name, isFile: () => file, isDirectory: () => !file });
  const promises = {
    stat: async (path: string) => {
      const folder = disk.folders.has(path);
      if (!folder && !disk.files.has(path)) throw nodeError('ENOENT');
      return { size: 0, mtimeMs: 0, isDirectory: () => folder, isFile: () => !folder };
    },
    readdir: async (path: string) => {
      if (!disk.folders.has(path)) throw nodeError('ENOENT');
      return [...disk.files.keys()].filter((file) => parent(file) === path).map((file) => entry(file.slice(path.length + 1), true));
    },
    readFile: async (path: string) => {
      const text = disk.files.get(path);
      if (text === undefined) throw nodeError('ENOENT');
      return text;
    },
    writeFile: async (path: string, text: string) => {
      if (!disk.folders.has(parent(path))) throw nodeError('ENOENT');
      if (disk.readOnly.has(parent(path))) throw nodeError('EACCES');
      disk.files.set(path, text);
    },
    unlink: async (path: string) => void disk.files.delete(path),
  };
  return { ...disk, node: { fs: { promises } as unknown as NodeFiles['fs'], sep: '/', home: '/home/gm' } };
}

const backupsInVault = (files: Map<string, string>): string[] => [...files.keys()].filter((path) => path.startsWith(`${BACKUPS_FOLDER}/`));

/** The world data as it lies in the vault: online play's data file and the worlds' folder. */
function worldOf(files: Map<string, string>): Record<string, string> {
  return Object.fromEntries([...files].filter(([path]) => path === ONLINE_DATA_PATH || path.startsWith('atlas-vtt/campaigns/')).sort(([a], [b]) => a.localeCompare(b)));
}

type TestApp = ReturnType<typeof createInMemoryApp>['app'];
const ALICE = 'aaaaaaaaaaaaaaaaaaaa';
const sharesText = (access: 'read' | 'write', format = 2): string => JSON.stringify({ format, shares: { 'Compendium/Fireball.md': { [ALICE]: access } } });

const WORLD: Record<string, string> = {
  [ONLINE_DATA_PATH]: JSON.stringify({ table: { code: 'ABCDEFGH', secret: 's'.repeat(43) } }),
  [`${CAMPAIGN}/campaign.json`]: JSON.stringify({ format: 1, id: 'c'.repeat(24), name: 'Greyhawk' }),
  [SHARES_PATH]: sharesText('read'),
};

const clock = (): { now: () => number; tick: () => void } => {
  let now = Date.UTC(2026, 10, 15, 9, 0, 0);
  return { now: () => now, tick: () => void (now += 60_000) };
};

/** The backups of `app`, made as the vault `vaultId`; the shares are read again after a restore, as the plugin does. */
function backupsOf(app: TestApp, now: () => number, options: { vaultId?: string; folder?: () => BackupFolder } = {}): WorldBackups {
  return new WorldBackups({
    vault: obsidianWorldVault(app),
    vaultId: options.vaultId ?? 'vault-a',
    folder: options.folder ?? (() => backupFolderOf(app, null, null)),
    now,
    settle: async () => undefined,
    quiet: (work) => work(),
    reload: () => PageShares.forApp(app).reload(),
  });
}

/** A backup folder that counts the backups read from it. */
function counting(folder: BackupFolder): { folder: BackupFolder; reads: () => number } {
  let reads = 0;
  return {
    folder: { ...folder, read: (name) => { reads += 1; return folder.read(name); } },
    reads: () => reads,
  };
}

describe('world backups', () => {
  it('backs up, survives a deliberate corruption and restores the world data to what it was', async () => {
    const { files, backups, quiet, tick } = setup();
    const made = await backups.create('manual');
    expect(made?.fileCount).toBe(Object.keys(ORIGINAL).length);

    // Corruption on purpose: an unreadable data file, a world file rewritten, one deleted, one added.
    tick();
    files.set(ONLINE_DATA_PATH, '{"table": {"code": "AB');
    files.set(`${CAMPAIGN}/campaign.json`, '{ broken');
    files.delete(`${CAMPAIGN}/players.json`);
    files.set(`${CAMPAIGN}/stray.json`, '{}');

    const { plan } = await backups.preview(made?.name ?? '');
    expect([...plan.replaced].sort()).toEqual([ONLINE_DATA_PATH, `${CAMPAIGN}/campaign.json`].sort());
    expect(plan.added).toEqual([`${CAMPAIGN}/players.json`]);
    expect(plan.removed).toEqual([`${CAMPAIGN}/stray.json`]);

    const result = await backups.restore(made?.name ?? '');
    expect(quiet).toHaveBeenCalledTimes(1);
    expect(worldOf(files)).toEqual(worldOf(new Map(Object.entries(ORIGINAL))));
    // The corrupted state was saved before anything was replaced, so the restore can itself be undone.
    const kept = (await backups.list()).find((summary) => summary.name === result.keptAs);
    expect(kept?.reason).toBe('before-restore');
    expect(kept?.fileCount).toBe(Object.keys(ORIGINAL).length);
    // Nothing outside the world data was touched.
    expect(files.get('atlas-vtt/.atlas-data/assets-metadata.json')).toBe('{}');
  });

  it('undoes a restore by restoring the backup it kept', async () => {
    const { files, backups, tick } = setup();
    const made = await backups.create('manual');
    tick();
    files.set(`${CAMPAIGN}/books.json`, '{"changed": true}');
    const changed = worldOf(files);
    const { keptAs } = await backups.restore(made?.name ?? '');
    tick();
    await backups.restore(keptAs ?? '');
    expect(worldOf(files)).toEqual(changed);
  });

  it('refuses a backup that cannot be read whole, and writes nothing', async () => {
    const { files, backups } = setup();
    files.set(`${BACKUPS_FOLDER}/broken.json`, '{"format": 1, "createdAt": 1, "reason": "manual", "files": {"atlas-vtt/campaigns/A/x.json": 12}}');
    files.set(`${BACKUPS_FOLDER}/outside.json`, JSON.stringify({ format: 1, createdAt: 1, reason: 'manual', files: { 'atlas-vtt/campaigns/../../.obsidian/app.json': 'e30=' } }));
    const before = worldOf(files);
    await expect(backups.restore('broken.json')).rejects.toBeInstanceOf(UnreadableBackupError);
    await expect(backups.restore('outside.json')).rejects.toBeInstanceOf(UnreadableBackupError);
    expect(worldOf(files)).toEqual(before);
    expect(await backups.list()).toEqual([]);
  });

  it('skips a scheduled backup when nothing changed, and keeps only the newest scheduled ones', async () => {
    const { files, backups, tick } = setup();
    expect(await backups.create('scheduled')).not.toBeNull();
    tick();
    expect(await backups.create('scheduled')).toBeNull();
    const manual = await backups.create('manual');
    for (let n = 0; n < KEPT_SCHEDULED_BACKUPS + 2; n += 1) {
      tick();
      files.set(`${CAMPAIGN}/books.json`, `{"n": ${n}}`);
      await backups.create('scheduled');
    }
    const list = await backups.list();
    expect(list.filter((summary) => summary.reason === 'scheduled')).toHaveLength(KEPT_SCHEDULED_BACKUPS);
    expect(list.some((summary) => summary.name === manual?.name)).toBe(true);
    expect(list[0]?.createdAt).toBeGreaterThan(list[list.length - 1]?.createdAt ?? Infinity);
  });

  it('makes no backup of a vault without world data', async () => {
    const { backups } = setup({});
    expect(await backups.create('manual')).toBeNull();
  });

  it('settles pending writes before it reads the world data', async () => {
    const { backups, settle } = setup();
    await backups.create('manual');
    expect(settle).toHaveBeenCalled();
  });
});

describe('a backup folder outside the vault', () => {
  const FOLDER = '/media/drive/atlas-backups';

  it('writes every kind of backup there, lists them from there and restores from there', async () => {
    const disk = diskFiles([FOLDER]);
    const { files, app, backups, tick } = setup(ORIGINAL, disk);
    saveBackupFolderPath(app, FOLDER);
    const made = await backups.create('manual');
    tick();
    // Unchanged data: the folder's newest backup already holds it.
    expect(await backups.create('scheduled')).toBeNull();
    files.set(`${CAMPAIGN}/books.json`, '{"scheduled": true}');
    await backups.create('scheduled');
    expect([...disk.files.keys()].every((path) => path.startsWith(`${FOLDER}/`))).toBe(true);
    expect(disk.files.size).toBe(2);
    expect(backupsInVault(files)).toEqual([]);

    tick();
    files.set(`${CAMPAIGN}/books.json`, '{"changed": true}');
    expect((await backups.list()).map((summary) => summary.name)).toContain(made?.name);
    const { keptAs } = await backups.restore(made?.name ?? '');
    expect(worldOf(files)).toEqual(worldOf(new Map(Object.entries(ORIGINAL))));
    expect(disk.files.has(`${FOLDER}/${keptAs}`)).toBe(true);
    expect(backupsInVault(files)).toEqual([]);
  });

  it('goes back to the vault folder once the choice is cleared', async () => {
    const disk = diskFiles([FOLDER]);
    const { files, app, backups } = setup(ORIGINAL, disk);
    saveBackupFolderPath(app, FOLDER);
    saveBackupFolderPath(app, null);
    await backups.create('manual');
    expect(disk.files.size).toBe(0);
    expect(backupsInVault(files)).toHaveLength(1);
  });

  it('fails without writing anywhere when the folder is gone', async () => {
    const disk = diskFiles([]);
    const { files, app, backups } = setup(ORIGINAL, disk);
    saveBackupFolderPath(app, FOLDER);
    const before = new Map(files);
    await expect(backups.create('manual')).rejects.toMatchObject({ problem: 'missing', folder: FOLDER });
    await expect(backups.create('scheduled')).rejects.toBeInstanceOf(BackupFolderError);
    await expect(backups.list()).rejects.toBeInstanceOf(BackupFolderError);
    expect(disk.files.size).toBe(0);
    expect(files).toEqual(before);
  });

  it('fails without writing anywhere when the folder refuses writing, and restores nothing', async () => {
    const disk = diskFiles([FOLDER]);
    const { files, app, backups, tick } = setup(ORIGINAL, disk);
    saveBackupFolderPath(app, FOLDER);
    const made = await backups.create('manual');
    disk.readOnly.add(FOLDER);
    tick();
    files.set(`${CAMPAIGN}/books.json`, '{"changed": true}');
    const before = new Map(files);
    await expect(backups.create('manual')).rejects.toMatchObject({ problem: 'unwritable' });
    // The data a restore would replace cannot be kept first, so nothing is replaced.
    await expect(backups.restore(made?.name ?? '')).rejects.toMatchObject({ problem: 'unwritable' });
    expect(files).toEqual(before);
    expect(disk.files.size).toBe(1);
  });

  it('never falls back on the vault where the chosen folder cannot be reached (no file system)', async () => {
    const { files, app, backups } = setup(ORIGINAL, null);
    saveBackupFolderPath(app, FOLDER);
    await expect(backups.create('manual')).rejects.toMatchObject({ problem: 'missing' });
    expect(backupsInVault(files)).toEqual([]);
  });
});

describe('the backup schedule', () => {
  it('is due once the interval has passed since the last backup, never while off', () => {
    const hour = 3_600_000;
    expect(backupDue('24h', null, 0)).toBe(true);
    expect(backupDue('24h', 0, 23 * hour)).toBe(false);
    expect(backupDue('24h', 0, 24 * hour)).toBe(true);
    expect(backupDue('off', null, 0)).toBe(false);
  });
});

describe('world backups hold the compendium shares', () => {
  it('backs the shares up and restores them, read again without a reload', async () => {
    const { app, files } = createInMemoryApp({ files: { ...WORLD } });
    const { now, tick } = clock();
    const backups = backupsOf(app, now);
    const shares = PageShares.forApp(app);
    await shares.load();
    const made = await backups.create('manual');
    expect(made?.fileCount).toBe(3);

    tick();
    await shares.share(['Compendium/Fireball.md'], { [ALICE]: 'write' });
    await shares.flush();
    expect(files.get(SHARES_PATH)).toContain('write');

    await backups.restore(made?.name ?? '');
    expect(files.get(SHARES_PATH)).toBe(WORLD[SHARES_PATH]);
    expect(shares.current().shares['Compendium/Fireball.md']).toEqual({ [ALICE]: 'read' });
  });

  it('removes shares made after the backup, and the shares read none', async () => {
    const { app, files } = createInMemoryApp({ files: { [`${CAMPAIGN}/campaign.json`]: WORLD[`${CAMPAIGN}/campaign.json`] ?? '' } });
    const { now, tick } = clock();
    const backups = backupsOf(app, now);
    const made = await backups.create('manual');
    tick();
    files.set(SHARES_PATH, sharesText('read'));
    const shares = PageShares.forApp(app);
    await shares.load();
    expect(Object.keys(shares.current().shares)).toHaveLength(1);
    const { plan } = await backups.preview(made?.name ?? '');
    expect(plan.removed).toEqual([SHARES_PATH]);
    await backups.restore(made?.name ?? '');
    expect(files.has(SHARES_PATH)).toBe(false);
    expect(shares.current().shares).toEqual({});
  });
});

describe('a backup folder inside atlas-vtt', () => {
  const VAULT = '/home/gm/Vault';

  it('is refused, and nothing is read or written there', async () => {
    const { app, files } = createInMemoryApp({ files: { ...WORLD } });
    const fail = vi.fn(async () => { throw new Error('the folder must not be touched'); });
    const node = { fs: { promises: { stat: fail, readdir: fail, readFile: fail, writeFile: fail, unlink: fail } }, sep: '/', home: '/home/gm' } as unknown as NodeFiles;
    saveBackupFolderPath(app, `${VAULT}/atlas-vtt/campaigns`);
    const backups = backupsOf(app, clock().now, { folder: () => backupFolderOf(app, node, VAULT) });
    const before = new Map(files);
    await expect(backups.create('manual')).rejects.toMatchObject({ problem: 'in-atlas-folder' });
    await expect(backups.list()).rejects.toMatchObject({ problem: 'in-atlas-folder' });
    expect(fail).not.toHaveBeenCalled();
    expect(files).toEqual(before);
  });

  it('tells a folder in atlas-vtt from one beside it', () => {
    expect(isInAtlasFolder(`${VAULT}/atlas-vtt`, VAULT, '/')).toBe(true);
    expect(isInAtlasFolder(`${VAULT}/atlas-vtt/`, VAULT, '/')).toBe(true);
    expect(isInAtlasFolder(`${VAULT}/atlas-vtt/.atlas-data/backups`, `${VAULT}/`, '/')).toBe(true);
    expect(isInAtlasFolder(`${VAULT}/atlas-vtt-backups`, VAULT, '/')).toBe(false);
    expect(isInAtlasFolder(`${VAULT}/Backups`, VAULT, '/')).toBe(false);
    expect(isInAtlasFolder('C:\\Users\\gm\\Vault\\ATLAS-VTT\\campaigns', 'C:\\Users\\gm\\Vault', '\\')).toBe(true);
    expect(isInAtlasFolder(`${VAULT}/atlas-vtt`, null, '/')).toBe(false);
  });
});

describe('what a backup folder lists and reads', () => {
  it('lists only world-*.json files as backups', async () => {
    const { app, files } = createInMemoryApp({ files: { ...WORLD } });
    const backups = backupsOf(app, clock().now);
    const made = await backups.create('manual');
    const text = files.get(`${BACKUPS_FOLDER}/${made?.name ?? ''}`) ?? '';
    files.set(`${BACKUPS_FOLDER}/notes.json`, text);
    expect((await backups.list()).map((summary) => summary.name)).toEqual([made?.name]);
  });

  it('reads only the newest backup for a scheduled one, and prunes by name', async () => {
    const { app, files } = createInMemoryApp({ files: { ...WORLD } });
    const { now, tick } = clock();
    const counted = counting(backupFolderOf(app, null, null));
    const backups = backupsOf(app, now, { folder: () => counted.folder });
    for (let n = 0; n < KEPT_SCHEDULED_BACKUPS + 2; n += 1) {
      tick();
      files.set(`${CAMPAIGN}/books.json`, `{"n": ${n}}`);
      const before = counted.reads();
      await backups.create('scheduled');
      expect(counted.reads() - before).toBeLessThanOrEqual(1);
    }
    tick();
    const before = counted.reads();
    expect(await backups.create('scheduled')).toBeNull();
    expect(counted.reads() - before).toBe(1);
    expect(await backups.newestAt()).toBe(now() - 60_000);
    expect(counted.reads() - before).toBe(2);
    expect((await backups.list()).filter((summary) => summary.reason === 'scheduled')).toHaveLength(KEPT_SCHEDULED_BACKUPS);
  });

  it('orders names by date, then by the number taken within one millisecond', () => {
    const at = Date.UTC(2026, 10, 15, 9, 0, 0);
    const older = backupName(at - 1, 'scheduled');
    const first = backupName(at, 'scheduled');
    const second = backupName(at, 'scheduled', 2);
    expect(newestFirst([older, first, second, 'world-copy.json'])).toEqual([second, first, older]);
  });
});

describe('paths a backup may name', () => {
  it('refuses backslashes and control characters', () => {
    expect(isWorldDataPath('atlas-vtt/campaigns/..\\..\\evil.json')).toBe(false);
    expect(isWorldDataPath('atlas-vtt/campaigns/A/x\u0000.json')).toBe(false);
    expect(isWorldDataPath('atlas-vtt/campaigns/A/x\u001f.json')).toBe(false);
    expect(isWorldDataPath('atlas-vtt/campaigns/A/x\u007f.json')).toBe(false);
    expect(isWorldDataPath('atlas-vtt/campaigns/A/b.json')).toBe(true);
    expect(isWorldDataPath(SHARES_PATH)).toBe(true);
    expect(isWorldDataPath(ONLINE_DATA_PATH)).toBe(true);
  });
});

describe('the vault a backup comes from', () => {
  it('is written into the backup, and a backup of another vault or of none is told', async () => {
    const { app, files } = createInMemoryApp({ files: { ...WORLD } });
    const { now, tick } = clock();
    const made = await backupsOf(app, now).create('manual');
    const path = `${BACKUPS_FOLDER}/${made?.name ?? ''}`;
    expect(JSON.parse(files.get(path) ?? '{}')).toMatchObject({ vaultId: 'vault-a' });
    tick();
    files.set(ONLINE_DATA_PATH, '{"table": null}');

    expect((await backupsOf(app, now).preview(made?.name ?? '')).otherVault).toBe(false);
    expect((await backupsOf(app, now, { vaultId: 'vault-b' }).preview(made?.name ?? '')).otherVault).toBe(true);
    const { vaultId: _dropped, ...unsigned } = JSON.parse(files.get(path) ?? '{}') as Record<string, unknown>;
    files.set(path, JSON.stringify(unsigned));
    expect((await backupsOf(app, now).preview(made?.name ?? '')).otherVault).toBe(true);
  });
});

describe('a shares file of a newer format', () => {
  it('is read and never written over', async () => {
    const newer = sharesText('read', 3);
    expect(parseShares(newer)).toEqual({ shares: { 'Compendium/Fireball.md': { [ALICE]: 'read' } }, newer: true });
    const { app, files } = createInMemoryApp({ files: { [SHARES_PATH]: newer } });
    const shares = PageShares.forApp(app);
    await shares.load();
    expect(shares.current().shares['Compendium/Fireball.md']).toEqual({ [ALICE]: 'read' });
    await expect(shares.share(['Compendium/Fireball.md'], { [ALICE]: 'write' })).rejects.toBeInstanceOf(NewerSharesError);
    await shares.flush();
    expect(files.get(SHARES_PATH)).toBe(newer);
  });
});
