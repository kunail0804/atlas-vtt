import type { App, Setting } from 'obsidian';
import { t, type MessageKey } from '../i18n';
import { nativeFolderPicker } from '../services/electronRemote';
import { nodeFilesOf } from '../soundLibrary/nodeFiles';
import { showNotice } from '../ui/notice';
import { BACKUPS_FOLDER } from '../worldBackups/backupFolder';
import { loadBackupFolderPath, saveBackupFolderPath } from '../worldBackups/backupLocation';
import { BACKUP_INTERVALS, loadBackupInterval, saveBackupInterval, type BackupInterval } from '../worldBackups/backupSchedule';
import { backupDate, folderProblemText, restoreBackupFlow } from '../worldBackups/restoreBackupFlow';
import type { WorldBackups } from '../worldBackups/WorldBackups';
import type { AtlasSettingSection } from './settingSections';

/** What the section needs: the backups, and the manual backup that also tells the schedule. */
export interface WorldBackupControls {
  readonly backups: WorldBackups;
  backUpNow(): ReturnType<WorldBackups['create']>;
}

const INTERVAL_KEYS: Readonly<Record<BackupInterval, MessageKey>> = {
  off: 'worldBackup.interval.off',
  '1h': 'worldBackup.interval.1h',
  '6h': 'worldBackup.interval.6h',
  '24h': 'worldBackup.interval.24h',
  '168h': 'worldBackup.interval.168h',
};

/** Where this device's backups go, as the GM reads it. */
const folderLabel = (app: App): string => loadBackupFolderPath(app) ?? t('worldBackup.defaultFolder', { folder: BACKUPS_FOLDER });

/** The system's folder picker, where a folder outside the vault can be written (the desktop app); null elsewhere. */
const outsideFolderPicker = (): ((title: string) => Promise<string | null>) | null => (nodeFilesOf(window) === null ? null : nativeFolderPicker(window));

/** Back up now, the backup folder (desktop app only), how often to back up, and restoring a backup. */
export function worldBackupsSettingsSection(app: App, controls: WorldBackupControls): AtlasSettingSection {
  /** Rows that name the folder, told when it changes. */
  const folderListeners = new Set<() => void>();
  const folderChanged = (): void => folderListeners.forEach((listener) => listener());
  const picker = outsideFolderPicker();
  return {
    heading: t('worldBackup.heading'),
    rows: [
      {
        name: t('worldBackup.backUpNow'),
        aliases: ['backup', 'save', 'world', 'campaign', 'online'],
        render: (setting) => renderBackUpRow(app, setting, controls, folderListeners),
      },
      ...(picker === null ? [] : [{
        name: t('worldBackup.folder'),
        aliases: ['backup', 'folder', 'directory', 'location', 'path'],
        render: (setting: Setting) => renderFolderRow(app, setting, picker, folderChanged),
      }]),
      {
        name: t('worldBackup.schedule'),
        desc: t('worldBackup.scheduleDesc'),
        aliases: ['backup', 'schedule', 'interval', 'automatic'],
        render: (setting) => {
          setting.addDropdown((dropdown) => {
            for (const interval of BACKUP_INTERVALS) dropdown.addOption(interval, t(INTERVAL_KEYS[interval]));
            dropdown.setValue(loadBackupInterval(app)).onChange((value) => {
              if (BACKUP_INTERVALS.includes(value as BackupInterval)) saveBackupInterval(app, value as BackupInterval);
            });
          });
        },
      },
      {
        name: t('worldBackup.restore'),
        desc: t('worldBackup.restoreDesc'),
        aliases: ['backup', 'restore', 'recover', 'world'],
        render: (setting) => {
          setting.addButton((button) => {
            button.setButtonText(t('worldBackup.restoreButton')).onClick(() => void restoreBackupFlow(app, controls.backups));
          });
        },
      },
    ],
  };
}

function renderFolderRow(app: App, setting: Setting, pick: (title: string) => Promise<string | null>, changed: () => void): void {
  let reset: { setDisabled(disabled: boolean): unknown } | null = null;
  const show = (): void => {
    setting.setDesc(t('worldBackup.folderDesc', { folder: folderLabel(app) }));
    reset?.setDisabled(loadBackupFolderPath(app) === null);
  };
  const choose = (path: string | null): void => {
    saveBackupFolderPath(app, path);
    show();
    changed();
  };
  setting.addButton((button) => {
    button.setButtonText(t('worldBackup.chooseFolder')).onClick(async () => {
      try {
        const path = await pick(t('worldBackup.chooseFolderTitle'));
        if (path !== null) choose(path);
      } catch (error) {
        console.error('[Atlas] Choosing the backup folder failed:', error);
      }
    });
  });
  setting.addButton((button) => {
    reset = button;
    button.setButtonText(t('worldBackup.defaultFolderButton')).onClick(() => choose(null));
  });
  show();
}

function renderBackUpRow(app: App, setting: Setting, controls: WorldBackupControls, folderListeners: Set<() => void>): () => void {
  let open = true;
  let newest: number | null | undefined;
  const describe = (): void => {
    if (!open) return;
    const what = t('worldBackup.backUpNowDesc', { folder: folderLabel(app) });
    if (newest === undefined) {
      setting.setDesc(what);
      return;
    }
    const last = newest === null ? t('worldBackup.noBackup') : t('worldBackup.lastBackup', { date: backupDate(newest) });
    setting.setDesc(`${what} ${last}`);
  };
  const list = (): void => {
    controls.backups.newestAt().then((at) => {
      newest = at;
      describe();
    }, (error: unknown) => {
      newest = undefined;
      describe();
      console.debug('[Atlas] The world backups could not be listed', error);
    });
  };
  describe();
  setting.addButton((button) => {
    button.setButtonText(t('worldBackup.backUpNow')).onClick(async () => {
      button.setDisabled(true);
      try {
        const made = await controls.backUpNow();
        showNotice(made === null ? t('worldBackup.nothingToSave') : t('worldBackup.saved'));
        if (made !== null) {
          newest = made.createdAt;
          describe();
        }
      } catch (error) {
        console.error('[Atlas] Saving a world backup failed:', error);
        showNotice(folderProblemText(error) ?? t('worldBackup.saveFailed'));
      } finally {
        button.setDisabled(false);
      }
    });
  });
  // Another folder holds other backups: the last one is looked up again.
  folderListeners.add(list);
  list();
  return () => {
    open = false;
    folderListeners.delete(list);
  };
}
