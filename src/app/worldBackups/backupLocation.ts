import { FileSystemAdapter, type App } from 'obsidian';
import { ATLAS_VTT_DIR } from '../services/assetPaths';
import { nodeFilesOf, type NodeFiles } from '../soundLibrary/nodeFiles';
import { BackupFolderError, vaultBackupFolder, type BackupFolder, type BackupFolderProblem } from './backupFolder';
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

/** The vault's folder on disk, where the vault has one (the desktop app). */
export const vaultBaseOf = (app: App): string | null => (app.vault.adapter instanceof FileSystemAdapter ? app.vault.adapter.getBasePath() : null);

/** A folder path compared as text: one separator, no trailing one, and without case on Windows. */
function comparable(path: string, sep: string): string {
  const slashed = path.replace(/[\\/]+/g, '/').replace(/\/$/, '');
  return sep === '\\' ? slashed.toLowerCase() : slashed;
}

/**
 * Whether `folder` lies in the vault's `atlas-vtt` folder or below it. Backups there would be world
 * data themselves (each new one holding the ones before, a restore trashing the others), or lie
 * among the files Atlas manages.
 */
export function isInAtlasFolder(folder: string, vaultBase: string | null, sep: string): boolean {
  if (vaultBase === null) return false;
  const root = comparable(`${vaultBase}${sep}${ATLAS_VTT_DIR}`, sep);
  const path = comparable(folder, sep);
  return path === root || path.startsWith(`${root}/`);
}

/**
 * The folder backups go to now: the one chosen on this device, else the default in the vault. A
 * chosen folder this device cannot reach (Node's files missing), or one inside the vault's
 * `atlas-vtt` folder, is a folder that fails, never the default in its place, so a backup meant to
 * leave the vault is never left in it.
 */
export function backupFolderOf(app: App, files: NodeFiles | null = nodeFilesOf(window), vaultBase: string | null = vaultBaseOf(app)): BackupFolder {
  const chosen = loadBackupFolderPath(app);
  if (chosen === null) return vaultBackupFolder(app);
  if (files === null) return failingFolder('missing', chosen);
  if (isInAtlasFolder(chosen, vaultBase, files.sep)) return failingFolder('in-atlas-folder', chosen);
  return diskBackupFolder(files.fs.promises, chosen, files.sep);
}

function failingFolder(problem: BackupFolderProblem, folder: string): BackupFolder {
  const fail = (): Promise<never> => Promise.reject(new BackupFolderError(problem, folder));
  return { names: fail, read: fail, write: fail, remove: fail };
}
