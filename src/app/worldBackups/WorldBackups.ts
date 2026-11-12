import {
  BACKUP_FORMAT, backupName, backupText, changesNothing, planRestore, readBackup, sameFiles,
  type BackupReason, type RestorePlan, type WorldBackup,
} from './worldBackupArchive';
import type { BackupFolder } from './backupFolder';
import type { WorldVault } from './worldVault';

/** Scheduled backups kept; older ones go. Backups the GM made and those a restore made stay until the GM removes them. */
export const KEPT_SCHEDULED_BACKUPS = 10;

/** A saved backup as the list shows it. */
export interface BackupSummary {
  readonly name: string;
  readonly createdAt: number;
  readonly reason: BackupReason;
  readonly fileCount: number;
}

/** What `restore` did: the plan it followed, and the backup that keeps the data it replaced (null when it changed nothing). */
export interface RestoreResult {
  readonly plan: RestorePlan;
  readonly keptAs: string | null;
}

export interface WorldBackupsDeps {
  readonly vault: WorldVault;
  /** The folder backups go to and are listed from, asked anew for every operation, so a change of folder holds at once. */
  readonly folder: () => BackupFolder;
  readonly now: () => number;
  /** Settles once every pending write of the world data is on disk, so a backup holds it. */
  readonly settle: () => Promise<void>;
  /**
   * Runs `work` while nothing else writes the world data (online play is switched off for it and
   * back on after), so what a restore writes is not saved over by what was held in memory.
   */
  readonly quiet: <T>(work: () => Promise<T>) => Promise<T>;
}

/** A backup that cannot be restored: unreadable, of another format, or naming a file outside the world data. */
export class UnreadableBackupError extends Error {
  constructor(readonly backupName: string) {
    super(`The world backup ${backupName} cannot be read.`);
  }
}

/**
 * Backs the world data up (online play's data and every world's files) and puts a backup back.
 * A restore first saves the data it replaces as a backup of its own, so a restore can be undone.
 */
export class WorldBackups {
  constructor(private readonly deps: WorldBackupsDeps) {}

  /**
   * Saves the world data as a backup; null when there is nothing to save, or for a scheduled backup
   * when the newest backup already holds exactly this data.
   */
  async create(reason: BackupReason): Promise<BackupSummary | null> {
    const folder = this.deps.folder();
    await this.deps.settle();
    return this.save(folder, reason, await this.deps.vault.readWorld());
  }

  /** The saved backups, newest first; a file that is no backup is left out. */
  async list(): Promise<BackupSummary[]> {
    return this.listIn(this.deps.folder());
  }

  private async listIn(folder: BackupFolder): Promise<BackupSummary[]> {
    const summaries: BackupSummary[] = [];
    for (const name of await folder.names()) {
      const backup = await this.read(folder, name).catch(() => null);
      if (backup !== null) summaries.push(summaryOf(name, backup));
    }
    return summaries.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
  }

  /** What restoring the backup `name` would change now. */
  async preview(name: string): Promise<RestorePlan> {
    const backup = await this.readOrThrow(this.deps.folder(), name);
    await this.deps.settle();
    return planRestore(await this.deps.vault.readWorld(), backup);
  }

  /**
   * Puts the backup `name` back: every file of the world data becomes what the backup holds, and
   * files the backup did not hold go. The data it replaces is saved first; nothing is written when
   * that save fails.
   */
  async restore(name: string): Promise<RestoreResult> {
    const folder = this.deps.folder();
    const backup = await this.readOrThrow(folder, name);
    return this.deps.quiet(async () => {
      await this.deps.settle();
      const current = await this.deps.vault.readWorld();
      const plan = planRestore(current, backup);
      if (changesNothing(plan)) return { plan, keptAs: null };
      const kept = await this.save(folder, 'before-restore', current, true);
      if (kept === null) throw new Error('The world data could not be saved before the restore.');
      for (const path of [...plan.replaced, ...plan.added]) await this.deps.vault.writeWorld(path, backup.files[path] ?? '');
      for (const path of plan.removed) await this.deps.vault.removeWorld(path);
      return { plan, keptAs: kept.name };
    });
  }

  /** The time the newest backup was made, or null when there is none. */
  async newestAt(): Promise<number | null> {
    const [newest] = await this.list();
    return newest?.createdAt ?? null;
  }

  private async save(folder: BackupFolder, reason: BackupReason, files: Record<string, string>, always = false): Promise<BackupSummary | null> {
    if (!always && Object.keys(files).length === 0) return null;
    if (reason === 'scheduled' && (await this.newestHolds(folder, files))) return null;
    const backup: WorldBackup = { format: BACKUP_FORMAT, createdAt: this.deps.now(), reason, files };
    const name = await this.freeName(folder, backup);
    await folder.write(name, backupText(backup));
    if (reason === 'scheduled') await this.pruneScheduled(folder);
    return summaryOf(name, backup);
  }

  private async newestHolds(folder: BackupFolder, files: Record<string, string>): Promise<boolean> {
    const [newest] = await this.listIn(folder);
    if (newest === undefined) return false;
    const backup = await this.read(folder, newest.name).catch(() => null);
    return backup !== null && sameFiles(backup.files, files);
  }

  /** The backup's name; two made in the same millisecond take a number. */
  private async freeName(folder: BackupFolder, backup: WorldBackup): Promise<string> {
    const taken = new Set(await folder.names());
    const base = backupName(backup.createdAt, backup.reason);
    let name = base;
    let n = 2;
    while (taken.has(name)) {
      name = base.replace(/\.json$/, `-${n}.json`);
      n += 1;
    }
    return name;
  }

  private async pruneScheduled(folder: BackupFolder): Promise<void> {
    const scheduled = (await this.listIn(folder)).filter((summary) => summary.reason === 'scheduled');
    for (const old of scheduled.slice(KEPT_SCHEDULED_BACKUPS)) await folder.remove(old.name);
  }

  private async read(folder: BackupFolder, name: string): Promise<WorldBackup | null> {
    return readBackup(await folder.read(name));
  }

  private async readOrThrow(folder: BackupFolder, name: string): Promise<WorldBackup> {
    const backup = await this.read(folder, name).catch(() => null);
    if (backup === null) throw new UnreadableBackupError(name);
    return backup;
  }
}

const summaryOf = (name: string, backup: WorldBackup): BackupSummary => ({
  name, createdAt: backup.createdAt, reason: backup.reason, fileCount: Object.keys(backup.files).length,
});
