import type { App } from 'obsidian';
import { ensureAdapterFolder } from '../plugin/vaultFolders';

/**
 * Where this device keeps world backups unless the GM chose another folder. They hold online play's
 * data, with the running table's secret, so they stay with that data in the folder no sync tool carries.
 */
export const BACKUPS_FOLDER = 'atlas-vtt/.atlas-data/backups';

/** Why a backup folder cannot be used: it does not exist (or is no folder), or it refuses writing. */
export type BackupFolderProblem = 'missing' | 'unwritable';

/** The backup folder cannot be used; nothing was written anywhere else instead. */
export class BackupFolderError extends Error {
  constructor(readonly problem: BackupFolderProblem, readonly folder: string, options?: { cause?: unknown }) {
    super(`The world backup folder ${folder} is ${problem === 'missing' ? 'missing' : 'not writable'}.`, options);
  }
}

/** The folder the backups lie in, by name: `backup-<date>-<reason>.json`. */
export interface BackupFolder {
  /** The names of the files in the folder that may be backups. */
  names(): Promise<string[]>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** The default folder, inside the vault, created on the first backup. */
export function vaultBackupFolder(app: App): BackupFolder {
  const { adapter } = app.vault;
  return {
    async names() {
      if (!(await adapter.exists(BACKUPS_FOLDER))) return [];
      const listed = await adapter.list(BACKUPS_FOLDER);
      return listed.files.map((path) => path.slice(BACKUPS_FOLDER.length + 1)).filter((name) => name.endsWith('.json'));
    },
    read: (name) => adapter.read(`${BACKUPS_FOLDER}/${name}`),
    async write(name, text) {
      await ensureAdapterFolder(app, BACKUPS_FOLDER);
      await adapter.write(`${BACKUPS_FOLDER}/${name}`, text);
    },
    remove: (name) => adapter.remove(`${BACKUPS_FOLDER}/${name}`),
  };
}
