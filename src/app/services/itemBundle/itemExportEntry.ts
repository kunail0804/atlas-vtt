import type { App } from 'obsidian';
import { t } from '../../i18n';
import type { ContextMenuEntry } from '../../react/components/context-menu/AtlasContextMenu';
import type { ItemRef } from './itemBundleFormat';
import { saveItemBundle } from './itemExport';

/** An item's own menu row: export it as a file to hand to someone (`saveItemBundle`). */
export function itemExportEntries(app: App, item: ItemRef): ContextMenuEntry[] {
  return [{ type: 'item', label: t('itemBundle.exportItem'), icon: 'download', onClick: () => { void saveItemBundle(app, item); } }];
}
