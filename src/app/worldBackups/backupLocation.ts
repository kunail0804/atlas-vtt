import type { App } from 'obsidian';
import { nodeFilesOf, type NodeFiles } from '../soundLibrary/nodeFiles';
import { BackupFolderError, vaultBackupFolder, type BackupFolder } from './backupFolder';
import { diskBackupFolder } from './diskBackupFolder';

/**
 * The folder outside the vault this device writes world backups to, as an absolute path. A path on
 * one computer means nothing on another, so the choice is a fact of the device, kept in the vault's
 * local storage like the backup interval. Unset is the default folder in the vault.
 */
export const BACKUP_FOLDER_STORAGE_KEY = 'atlas-vtt:world-backup-folder';

type DeviceStorage = Pick<App, 'loadLocalStorage' | 'saveLocalStorage'>;

/** The chosen folder, or null for the default one in the vault. */
export function loadBackupFolderPath(storage: DeviceStorage): string | null {
  try {
    const stored: unknown = storage.loadLocalStorage(BACKUP_FOLDER_STORAGE_KEY);
    return typeof stored === 'string' && stored.trim() !== '' ? stored : null;
  } catch (error) {
    console.error('[Atlas] Could not read the backup folder of this device', error);
    return null;
  }
}

/** Keeps `path` as this device's backup folder; null goes back to the default one. */
export function saveBackupFolderPath(storage: DeviceStorage, path: string | null): void {
  try {
    // Obsidian removes the key for a falsy value, which reads back as the default.
    storage.saveLocalStorage(BACKUP_FOLDER_STORAGE_KEY, path);
  } catch (error) {
    console.error('[Atlas] Could not save the backup folder of this device', error);
  }
}

/**
 * The folder backups go to now: the one chosen on this device, else the default in the vault. A
 * chosen folder this device cannot reach (Node's files missing) is a folder that fails, never the
 * default in its place, so a backup meant to leave the vault is never left in it.
 */
export function backupFolderOf(app: App, files: NodeFiles | null = nodeFilesOf(window)): BackupFolder {
  const chosen = loadBackupFolderPath(app);
  if (chosen === null) return vaultBackupFolder(app);
  if (files === null) return unreachableFolder(chosen);
  return diskBackupFolder(files.fs.promises, chosen, files.sep);
}

function unreachableFolder(folder: string): BackupFolder {
  const fail = (): Promise<never> => Promise.reject(new BackupFolderError('missing', folder));
  return { names: fail, read: fail, write: fail, remove: fail };
}
