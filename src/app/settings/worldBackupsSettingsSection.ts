import type { App, Setting } from 'obsidian';
import { t, type MessageKey } from '../i18n';
import { showNotice } from '../ui/notice';
import { BACKUP_INTERVALS, loadBackupInterval, saveBackupInterval, type BackupInterval } from '../worldBackups/backupSchedule';
import { backupDate, restoreBackupFlow } from '../worldBackups/restoreBackupFlow';
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

/** Back up now, how often to back up, and restoring a backup. */
export function worldBackupsSettingsSection(app: App, controls: WorldBackupControls): AtlasSettingSection {
  return {
    heading: t('worldBackup.heading'),
    rows: [
      {
        name: t('worldBackup.backUpNow'),
        aliases: ['backup', 'save', 'world', 'campaign', 'online'],
        render: (setting) => renderBackUpRow(setting, controls),
      },
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

function renderBackUpRow(setting: Setting, controls: WorldBackupControls): () => void {
  let open = true;
  const describe = (newest: number | null): void => {
    if (!open) return;
    const last = newest === null ? t('worldBackup.noBackup') : t('worldBackup.lastBackup', { date: backupDate(newest) });
    setting.setDesc(`${t('worldBackup.backUpNowDesc')} ${last}`);
  };
  setting.setDesc(t('worldBackup.backUpNowDesc'));
  setting.addButton((button) => {
    button.setButtonText(t('worldBackup.backUpNow')).onClick(async () => {
      button.setDisabled(true);
      try {
        const made = await controls.backUpNow();
        showNotice(made === null ? t('worldBackup.nothingToSave') : t('worldBackup.saved'));
        if (made !== null) describe(made.createdAt);
      } catch (error) {
        console.error('[Atlas] Saving a world backup failed:', error);
        showNotice(t('worldBackup.saveFailed'));
      } finally {
        button.setDisabled(false);
      }
    });
  });
  controls.backups.newestAt().then(describe, (error: unknown) => console.debug('[Atlas] The world backups could not be listed', error));
  return () => {
    open = false;
  };
}
