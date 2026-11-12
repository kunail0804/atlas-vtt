import { describe, expect, it, vi } from 'vitest';
import { createInMemoryApp } from '../../mocks/inMemoryVault';
import { ONLINE_DATA_PATH } from '../../../src/app/online/gm/onlineData';
import { BACKUPS_FOLDER, obsidianWorldVault } from '../../../src/app/worldBackups/worldVault';
import { KEPT_SCHEDULED_BACKUPS, UnreadableBackupError, WorldBackups } from '../../../src/app/worldBackups/WorldBackups';
import { backupDue } from '../../../src/app/worldBackups/backupSchedule';

const CAMPAIGN = 'atlas-vtt/campaigns/Greyhawk';
const ORIGINAL: Record<string, string> = {
  [ONLINE_DATA_PATH]: JSON.stringify({ reportErrors: false, table: { code: 'ABCDEFGH', secret: 's'.repeat(43), campaignId: 'c'.repeat(24) }, tableLog: { entries: [{ text: 'Hello' }] } }),
  [`${CAMPAIGN}/campaign.json`]: JSON.stringify({ format: 1, id: 'c'.repeat(24), name: 'Greyhawk', sources: ['dnd5e-2014/srd-5.1'] }, null, 2),
  [`${CAMPAIGN}/players.json`]: JSON.stringify({ format: 1, campaignId: 'c'.repeat(24), link: 'ABCDEFGH', players: { p1: { name: 'Ann', code: '123456', characters: [] } } }, null, 2),
  [`${CAMPAIGN}/books.json`]: JSON.stringify({ format: 1, campaignId: 'c'.repeat(24), books: {} }),
  'atlas-vtt/campaigns/Eberron/campaign.json': JSON.stringify({ format: 1, id: 'e'.repeat(24), name: 'Eberron' }),
};

/** A vault holding the original world data, the backups service over it, and a clock the test moves. */
function setup(files: Record<string, string> = ORIGINAL): { files: Map<string, string>; backups: WorldBackups; quiet: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn>; tick(ms?: number): void } {
  const memory = createInMemoryApp({ files: { ...files, 'atlas-vtt/.atlas-data/assets-metadata.json': '{}' } });
  let now = Date.UTC(2026, 10, 12, 20, 0, 0);
  const settle = vi.fn(async () => undefined);
  const quiet = vi.fn(<T>(work: () => Promise<T>): Promise<T> => work());
  const backups = new WorldBackups({ vault: obsidianWorldVault(memory.app), now: () => now, settle, quiet });
  return { files: memory.files, backups, quiet, settle, tick: (ms = 1000) => void (now += ms) };
}

/** The world data as it lies in the vault: online play's data file and the worlds' folder. */
function worldOf(files: Map<string, string>): Record<string, string> {
  return Object.fromEntries([...files].filter(([path]) => path === ONLINE_DATA_PATH || path.startsWith('atlas-vtt/campaigns/')).sort(([a], [b]) => a.localeCompare(b)));
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

    const plan = await backups.preview(made?.name ?? '');
    expect(plan.replaced).toEqual([ONLINE_DATA_PATH, `${CAMPAIGN}/campaign.json`].sort());
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

describe('the backup schedule', () => {
  it('is due once the interval has passed since the last backup, never while off', () => {
    const hour = 3_600_000;
    expect(backupDue('24h', null, 0)).toBe(true);
    expect(backupDue('24h', 0, 23 * hour)).toBe(false);
    expect(backupDue('24h', 0, 24 * hour)).toBe(true);
    expect(backupDue('off', null, 0)).toBe(false);
  });
});
