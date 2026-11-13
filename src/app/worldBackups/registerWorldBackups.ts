import type { Plugin } from 'obsidian';
import { CampaignFiles } from '../campaigns/CampaignFiles';
import { PartySync } from '../campaigns/partyValues/PartySync';
import { CampaignBooks } from '../campaigns/players/CampaignBooks';
import { TablePlayers } from '../campaigns/players/TablePlayers';
import type { OnlinePlay } from '../plugin/onlinePlay';
import type { WorldBackupControls } from '../settings/worldBackupsSettingsSection';
import { showNotice } from '../ui/notice';
import { backupFolderOf } from './backupLocation';
import { backupDue, loadBackupInterval } from './backupSchedule';
import { folderProblemText } from './restoreBackupFlow';
import { WorldBackups, type BackupSummary } from './WorldBackups';
import { obsidianWorldVault } from './worldVault';

/** How often the schedule looks whether a backup is due; the shortest interval offered is an hour. */
const CHECK_MS = 10 * 60_000;

/**
 * World backups for the plugin: the service, the schedule (looked at once the workspace is ready
 * and every `CHECK_MS` after), and what the settings section offers.
 */
export function registerWorldBackups(plugin: Plugin, onlinePlay: OnlinePlay): WorldBackupControls {
  const { app } = plugin;
  const backups = new WorldBackups({
    vault: obsidianWorldVault(app),
    folder: () => backupFolderOf(app),
    now: () => Date.now(),
    settle: async () => {
      await Promise.all([
        onlinePlay.flush(),
        CampaignFiles.forApp(app)?.flush(),
        TablePlayers.forApp(app)?.flush(),
        CampaignBooks.forApp(app)?.flush(),
        PartySync.forApp(app)?.flush(),
      ]);
    },
    quiet: (work) => onlinePlay.paused(work),
  });

  /** When the last backup was made or found; undefined until the backups were listed once. */
  let lastAt: number | null | undefined;
  let checking = false;
  /** The folder problem last told; a failing folder is told once, not at every check until it is fixed. */
  let told: string | null = null;
  const noted = (made: BackupSummary | null, at: number): BackupSummary | null => {
    lastAt = made?.createdAt ?? at;
    return made;
  };
  const check = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      lastAt ??= await backups.newestAt();
      const now = Date.now();
      if (!backupDue(loadBackupInterval(app), lastAt, now)) return;
      // A skipped backup (nothing changed) still counts, so unchanged data is not read again before the next interval.
      noted(await backups.create('scheduled'), now);
      told = null;
    } catch (error) {
      console.error('[Atlas] A scheduled world backup failed:', error);
      const problem = folderProblemText(error);
      if (problem !== null && problem !== told) showNotice(problem);
      told = problem;
    } finally {
      checking = false;
    }
  };
  app.workspace.onLayoutReady(() => void check());
  plugin.registerInterval(window.setInterval(() => void check(), CHECK_MS));

  return {
    backups,
    backUpNow: async () => noted(await backups.create('manual'), Date.now()),
  };
}
