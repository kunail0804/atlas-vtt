import { describe, expect, it, vi } from 'vitest';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { ONLINE_DATA_PATH } from '../../../src/app/online/gm/onlineData';
import { NewerSharesError, PageShares } from '../../../src/app/players/PageShares';
import { parseShares, SHARES_PATH } from '../../../src/app/players/shares';
import type { NodeFiles } from '../../../src/app/soundLibrary/nodeFiles';
import { BACKUPS_FOLDER, type BackupFolder } from '../../../src/app/worldBackups/backupFolder';
import { backupFolderOf, isInAtlasFolder, saveBackupFolderPath } from '../../../src/app/worldBackups/backupLocation';
import { backupName, isWorldDataPath, newestFirst } from '../../../src/app/worldBackups/worldBackupArchive';
import { KEPT_SCHEDULED_BACKUPS, WorldBackups } from '../../../src/app/worldBackups/WorldBackups';
import { obsidianWorldVault } from '../../../src/app/worldBackups/worldVault';

type TestApp = ReturnType<typeof createInMemoryApp>['app'];

const CAMPAIGN = 'atlas-vtt/campaigns/Greyhawk';
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
