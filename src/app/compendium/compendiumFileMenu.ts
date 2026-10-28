import { TFolder, type App, type Plugin } from 'obsidian';
import { downloadBlob } from '../utils/downloadBlob';
import { showNotice } from '../ui/notice';
import { t } from '../i18n';
import { CompendiumService } from './CompendiumService';
import { sourceFolderNames } from './sourceExport';

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

/** "Export as compendium source" on the folders `Compendium/<system>/<book>`; Obsidian drops the handler when the plugin unloads. */
export function registerCompendiumFileMenu(plugin: Plugin): void {
  const { app } = plugin;
  plugin.registerEvent(app.workspace.on('file-menu', (menu, file) => {
    if (!(file instanceof TFolder) || sourceFolderNames(file.path) === null) return;
    menu.addItem((item) => item
      .setTitle(t('compendium.export'))
      .setIcon('package')
      .onClick(() => exportCompendiumBook(app, file.path)));
  }));
}
