import { FuzzySuggestModal, TFolder, type App, type Plugin } from 'obsidian';
import { downloadBlob } from '../utils/downloadBlob';
import { showNotice } from '../ui/notice';
import { t } from '../i18n';
import { CompendiumService } from './CompendiumService';
import { slugOf, sourceFolderNames } from './sourceExport';
import { PERSONAL_BOOK_ID } from './sourceTree';
import { COMPENDIUM_ROOT } from './sourceFormat';

/** Exports the folder `Compendium/<system>/<book>` as a source zip to the downloads folder, telling the GM how it went. */
export async function exportCompendiumBook(app: App, path: string): Promise<void> {
  try {
    const exported = await CompendiumService.forApp(app).exportFolder(path);
    downloadBlob(exported.zip, exported.fileName);
    showNotice(t('compendium.exported', { name: exported.manifest.book.name, file: exported.fileName }));
  } catch (error) {
    console.error('[compendiumFileMenu] Export failed:', error);
    showNotice(t('compendium.exportFailed', { error: error instanceof Error ? error.message : String(error) }));
  }
}

/** Whether a book folder is a system's Personal book, which is never exported. */
export const isPersonalFolder = (path: string): boolean => slugOf(path.slice(path.lastIndexOf('/') + 1)) === PERSONAL_BOOK_ID;

/** Every folder `Compendium/<system>/<book>` of the vault that can be exported, by system then book. */
export function compendiumBookFolders(app: App): TFolder[] {
  const root = app.vault.getFolderByPath(COMPENDIUM_ROOT);
  if (!(root instanceof TFolder)) return [];
  const foldersIn = (folder: TFolder): TFolder[] => folder.children
    .filter((child): child is TFolder => child instanceof TFolder)
    .map((child) => app.vault.getFolderByPath(child.path) ?? child);
  const books = foldersIn(root).flatMap(foldersIn).filter((book) => sourceFolderNames(book.path) !== null && !isPersonalFolder(book.path));
  return books.sort((a, b) => a.path.localeCompare(b.path));
}

/** The book folder a vault path lies in, `Compendium/<system>/<book>`; null outside every book. */
export function bookFolderOf(path: string): string | null {
  const parts = path.split('/');
  if (parts.length < 3 || parts[0] !== COMPENDIUM_ROOT) return null;
  const folder = parts.slice(0, 3).join('/');
  return sourceFolderNames(folder) === null ? null : folder;
}

/** The book folders to choose from, "D&D 5e 2014 · Personal". */
class BookFolderModal extends FuzzySuggestModal<TFolder> {
  constructor(app: App, private readonly folders: readonly TFolder[], private readonly choose: (folder: TFolder) => void) {
    super(app);
    this.setPlaceholder(t('compendium.exportChoose'));
  }

  getItems(): TFolder[] {
    return [...this.folders];
  }

  getItemText(folder: TFolder): string {
    return `${folder.parent?.name ?? ''} · ${folder.name}`;
  }

  onChooseItem(folder: TFolder): void {
    this.choose(folder);
  }
}

/**
 * The command "Export a compendium book as a source": the book of the note open now, else the
 * book the GM picks among the vault's.
 */
function registerExportCommand(plugin: Plugin): void {
  const { app } = plugin;
  plugin.addCommand({
    id: 'export-compendium-source',
    name: t('command.exportCompendiumSource'),
    checkCallback: (checking) => {
      const folders = compendiumBookFolders(app);
      if (folders.length === 0) return false;
      if (checking) return true;
      const active = app.workspace.getActiveFile();
      const book = active === null ? null : bookFolderOf(active.path);
      const current = book !== null && !isPersonalFolder(book) ? book : null;
      if (current !== null) void exportCompendiumBook(app, current);
      else new BookFolderModal(app, folders, (folder) => void exportCompendiumBook(app, folder.path)).open();
      return true;
    },
  });
}

/**
 * "Export as compendium source" on the folders `Compendium/<system>/<book>`, and the command of the
 * same use; Obsidian drops both when the plugin unloads.
 */
export function registerCompendiumFileMenu(plugin: Plugin): void {
  const { app } = plugin;
  plugin.registerEvent(app.workspace.on('file-menu', (menu, file) => {
    if (!(file instanceof TFolder) || sourceFolderNames(file.path) === null || isPersonalFolder(file.path)) return;
    menu.addItem((item) => item
      .setTitle(t('compendium.export'))
      .setIcon('package')
      .onClick(() => exportCompendiumBook(app, file.path)));
  }));
  registerExportCommand(plugin);
}
