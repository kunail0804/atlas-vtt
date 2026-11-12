import { base64ToArrayBuffer, TFile, type App } from 'obsidian';
import { CAMPAIGNS_FOLDER } from '../campaigns/campaignPaths';
import { ONLINE_DATA_PATH } from '../online/gm/onlineData';
import { toBase64 } from '../online/gm/assetServe';
import { ensureAdapterFolder } from '../plugin/vaultFolders';

/**
 * Where this device keeps world backups. They hold online play's data, with the running table's
 * secret, so they stay with that data in the folder no sync tool carries.
 */
export const BACKUPS_FOLDER = 'atlas-vtt/.atlas-data/backups';

/** What world backups need of the vault: the world data's files, and the backups themselves. */
export interface WorldVault {
  /** Every file of the world data now: vault path → bytes as base64. */
  readWorld(): Promise<Record<string, string>>;
  /** Writes one file of the world data, creating its folders. */
  writeWorld(path: string, base64: string): Promise<void>;
  /** Removes one file of the world data. */
  removeWorld(path: string): Promise<void>;
  /** The names of the saved backups. */
  backupNames(): Promise<string[]>;
  readBackup(name: string): Promise<string>;
  writeBackup(name: string, text: string): Promise<void>;
  removeBackup(name: string): Promise<void>;
}

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/**
 * The world data in an Obsidian vault. Files in visible folders are written and removed through the
 * vault, so the worlds' files Atlas holds open (`RecordFiles`) hear of the change; online play's data
 * lies in a hidden folder the vault does not index, and goes through the adapter.
 */
export function obsidianWorldVault(app: App): WorldVault {
  const { vault } = app;
  const { adapter } = vault;

  const listFiles = async (folder: string, into: string[]): Promise<void> => {
    if (!(await adapter.exists(folder))) return;
    const listed = await adapter.list(folder);
    into.push(...listed.files);
    for (const inner of listed.folders) await listFiles(inner, into);
  };

  const ensureVisibleFolder = async (folder: string): Promise<void> => {
    if (folder === '' || vault.getFolderByPath(folder)) return;
    await ensureVisibleFolder(parentOf(folder));
    await vault.createFolder(folder).catch(() => undefined);
  };

  return {
    async readWorld() {
      const paths: string[] = [];
      if (await adapter.exists(ONLINE_DATA_PATH)) paths.push(ONLINE_DATA_PATH);
      await listFiles(CAMPAIGNS_FOLDER, paths);
      const files: Record<string, string> = {};
      for (const path of paths) files[path] = toBase64(new Uint8Array(await adapter.readBinary(path)));
      return files;
    },
    async writeWorld(path, base64) {
      const bytes = base64ToArrayBuffer(base64);
      const file = vault.getAbstractFileByPath(path);
      if (file instanceof TFile) return vault.modifyBinary(file, bytes);
      if (path === ONLINE_DATA_PATH) {
        await ensureAdapterFolder(app, parentOf(path));
        return adapter.writeBinary(path, bytes);
      }
      await ensureVisibleFolder(parentOf(path));
      await vault.createBinary(path, bytes);
    },
    async removeWorld(path) {
      const file = vault.getAbstractFileByPath(path);
      // Obsidian's trash, as the GM set it: what a restore takes away can still be found there.
      if (file instanceof TFile) return app.fileManager.trashFile(file);
      if (await adapter.exists(path)) await adapter.remove(path);
    },
    async backupNames() {
      if (!(await adapter.exists(BACKUPS_FOLDER))) return [];
      const listed = await adapter.list(BACKUPS_FOLDER);
      return listed.files.map((path) => path.slice(BACKUPS_FOLDER.length + 1)).filter((name) => name.endsWith('.json'));
    },
    readBackup: (name) => adapter.read(`${BACKUPS_FOLDER}/${name}`),
    async writeBackup(name, text) {
      await ensureAdapterFolder(app, BACKUPS_FOLDER);
      await adapter.write(`${BACKUPS_FOLDER}/${name}`, text);
    },
    removeBackup: (name) => adapter.remove(`${BACKUPS_FOLDER}/${name}`),
  };
}
