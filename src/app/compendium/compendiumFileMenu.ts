import { TFolder, type Plugin } from 'obsidian';
import { downloadBlob } from '../utils/downloadBlob';
import { showNotice } from '../ui/notice';
import { t } from '../i18n';
import { CompendiumService } from './CompendiumService';
import { sourceFolderNames } from './sourceExport';

/** "Export as compendium source" on the folders `Compendium/<system>/<book>`; Obsidian drops the handler when the plugin unloads. */
export function registerCompendiumFileMenu(plugin: Plugin): void {
  const { app } = plugin;
  plugin.registerEvent(app.workspace.on('file-menu', (menu, file) => {
    if (!(file instanceof TFolder) || sourceFolderNames(file.path) === null) return;
    menu.addItem((item) => item
      .setTitle(t('compendium.export'))
      .setIcon('package')
      .onClick(async () => {
        try {
          const exported = await CompendiumService.forApp(app).exportFolder(file.path);
          downloadBlob(exported.zip, exported.fileName);
          showNotice(t('compendium.exported', { name: exported.manifest.book.name, file: exported.fileName }));
        } catch (error) {
          console.error('[compendiumFileMenu] Export failed:', error);
          showNotice(t('compendium.exportFailed', { error: error instanceof Error ? error.message : String(error) }));
        }
      }));
  }));
}
