import { TFile, TFolder, type App } from 'obsidian';
import { ensureFolder } from '../plugin/vaultFolders';
import { sha256 } from '../utils/hashing';
import { trashVaultItem } from '../utils/trashVaultItem';
import { COMPENDIUM_ROOT } from './sourceFormat';
import type { CompendiumVault } from './sourceInstall';

const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

/** The installer's vault: the app's, through Obsidian's file API so its index and links follow. */
export function obsidianCompendiumVault(app: App): CompendiumVault {
  const write = async (path: string, data: Uint8Array): Promise<void> => {
    const buffer = data.slice().buffer;
    const existing = app.vault.getFileByPath(path);
    if (existing) {
      await app.vault.modifyBinary(existing, buffer);
      return;
    }
    const parent = parentOf(path);
    if (parent !== '') await ensureFolder(app, parent);
    await app.vault.createBinary(path, buffer);
  };

  const trashEmpty = async (folder: TFolder): Promise<void> => {
    for (const child of [...folder.children]) {
      if (child instanceof TFolder) await trashEmpty(child);
    }
    // Looked up again: the handle may list what was just trashed.
    const current = app.vault.getFolderByPath(folder.path);
    if (current && current.children.length === 0) await trashVaultItem(app, current);
  };

  return {
    fingerprint: async (path) => {
      const file = app.vault.getFileByPath(path);
      return file ? sha256(await app.vault.readBinary(file)) : null;
    },
    write,
    trash: async (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      if (file) await trashVaultItem(app, file);
    },
    trashEmptyFolders: async (root) => {
      const folder = app.vault.getFolderByPath(root);
      if (folder) await trashEmpty(folder);
      // Then the rule set's folder, when its last book is gone; the Compendium folder itself stays.
      for (let parent = parentOf(root); parent.startsWith(`${COMPENDIUM_ROOT}/`); parent = parentOf(parent)) {
        const current = app.vault.getFolderByPath(parent);
        if (!current || current.children.length > 0) break;
        await trashVaultItem(app, current);
      }
    },
    readText: async (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? app.vault.read(file) : null;
    },
    writeText: (path, text) => write(path, new TextEncoder().encode(text)),
  };
}
