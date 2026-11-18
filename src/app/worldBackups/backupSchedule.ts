import type { App } from 'obsidian';

/**
 * How often this device backs the world data up. The backups lie on this device, so the choice is
 * a fact of the device too, kept in the vault's local storage.
 */
export const BACKUP_INTERVAL_STORAGE_KEY = 'atlas-vtt:world-backup-interval';

/** The choices offered; `off` makes no scheduled backups. */
export const BACKUP_INTERVALS = ['off', '1h', '6h', '24h', '168h'] as const;
export type BackupInterval = (typeof BACKUP_INTERVALS)[number];

/** Daily: a lost evening of play at most, and ten backups cover more than a week. */
export const DEFAULT_BACKUP_INTERVAL: BackupInterval = '24h';

const HOUR_MS = 3_600_000;

export const intervalMs = (interval: BackupInterval): number | null => (interval === 'off' ? null : Number.parseInt(interval, 10) * HOUR_MS);

const isInterval = (value: unknown): value is BackupInterval => BACKUP_INTERVALS.includes(value as BackupInterval);

type DeviceStorage = Pick<App, 'loadLocalStorage' | 'saveLocalStorage'>;

export function loadBackupInterval(storage: DeviceStorage): BackupInterval {
  try {
    const stored: unknown = storage.loadLocalStorage(BACKUP_INTERVAL_STORAGE_KEY);
    return isInterval(stored) ? stored : DEFAULT_BACKUP_INTERVAL;
  } catch (error) {
    console.error('[Atlas] Could not read the backup interval of this device', error);
    return DEFAULT_BACKUP_INTERVAL;
  }
}

export function saveBackupInterval(storage: DeviceStorage, interval: BackupInterval): void {
  try {
    // Every choice is a non-empty string, which Obsidian keeps (it drops falsy values).
    storage.saveLocalStorage(BACKUP_INTERVAL_STORAGE_KEY, interval);
  } catch (error) {
    console.error('[Atlas] Could not save the backup interval of this device', error);
  }
}

/** Whether a scheduled backup is due at `now`, the last one (or the newest of any kind) made at `last`. */
export function backupDue(interval: BackupInterval, last: number | null, now: number): boolean {
  const every = intervalMs(interval);
  if (every === null) return false;
  return last === null || now - last >= every;
}
