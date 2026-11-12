import { SuggestModal, type App } from 'obsidian';
import { ChoiceModal } from '../plugin/ChoiceModal';
import { ATLAS_NATIVE_MODAL_CLASSES } from '../ui/nativeModal';
import { showNotice } from '../ui/notice';
import { formatList, getLocale, t, type MessageKey } from '../i18n';
import type { RestorePlan } from './worldBackupArchive';
import { changesNothing } from './worldBackupArchive';
import { UnreadableBackupError, type BackupSummary, type WorldBackups } from './WorldBackups';

/** A backup's date as the GM reads it. */
export const backupDate = (createdAt: number): string => new Date(createdAt).toLocaleString(getLocale(), { dateStyle: 'medium', timeStyle: 'short' });

const REASON_KEYS: Readonly<Record<BackupSummary['reason'], MessageKey>> = {
  manual: 'worldBackup.reason.manual',
  scheduled: 'worldBackup.reason.scheduled',
  'before-restore': 'worldBackup.reason.before-restore',
};

const describe = (summary: BackupSummary): string => `${t(REASON_KEYS[summary.reason])} · ${t('worldBackup.files', { count: summary.fileCount })}`;

/** The saved backups, newest first, to pick the one to restore. Resolves once, with the choice or null. */
class BackupPicker extends SuggestModal<BackupSummary> {
  private chosen: BackupSummary | null = null;

  constructor(app: App, private readonly backups: readonly BackupSummary[], private readonly done: (summary: BackupSummary | null) => void) {
    super(app);
    this.setPlaceholder(t('worldBackup.pickPlaceholder'));
    this.modalEl.addClass(...ATLAS_NATIVE_MODAL_CLASSES);
  }

  getSuggestions(query: string): BackupSummary[] {
    const wanted = query.trim().toLowerCase();
    return this.backups.filter((summary) => `${backupDate(summary.createdAt)} ${describe(summary)}`.toLowerCase().includes(wanted));
  }

  renderSuggestion(summary: BackupSummary, el: HTMLElement): void {
    el.createDiv({ text: backupDate(summary.createdAt) });
    el.createEl('small', { text: describe(summary), cls: 'setting-item-description' });
  }

  onChooseSuggestion(summary: BackupSummary): void {
    this.chosen = summary;
  }

  onClose(): void {
    super.onClose();
    // Obsidian closes the modal before it hands over the choice; the choice is read a tick later.
    window.setTimeout(() => this.done(this.chosen), 0);
  }
}

/** One paragraph per kind of change; none for a kind the restore does not make. */
function planParagraphs(plan: RestorePlan): string[] {
  const lines: Array<[MessageKey, readonly string[]]> = [
    ['worldBackup.previewReplaced', plan.replaced],
    ['worldBackup.previewAdded', plan.added],
    ['worldBackup.previewRemoved', plan.removed],
  ];
  return lines.filter(([, paths]) => paths.length > 0).map(([key, paths]) => t(key, { count: paths.length, paths: formatList(paths) }));
}

/**
 * Restores a backup without a command line: the GM picks one, sees which files it replaces, brings
 * back and moves to the trash, and confirms; the current data is saved as a backup before the restore.
 */
export async function restoreBackupFlow(app: App, backups: WorldBackups): Promise<void> {
  const list = await backups.list();
  if (list.length === 0) {
    showNotice(t('worldBackup.noBackups'));
    return;
  }
  const picked = await new Promise<BackupSummary | null>((resolve) => new BackupPicker(app, list, resolve).open());
  if (picked === null) return;
  try {
    const plan = await backups.preview(picked.name);
    if (changesNothing(plan)) {
      showNotice(t('worldBackup.unchanged'));
      return;
    }
    const confirmed = await new ChoiceModal<true>(app, {
      title: t('worldBackup.previewTitle', { date: backupDate(picked.createdAt) }),
      message: planParagraphs(plan),
      hint: t('worldBackup.previewHint'),
      buttons: [{ text: t('worldBackup.confirm'), value: true, variant: 'warning' }],
    }).prompt();
    if (confirmed !== true) return;
    const result = await backups.restore(picked.name);
    showNotice(result.keptAs === null ? t('worldBackup.unchanged') : t('worldBackup.restored'));
  } catch (error) {
    if (error instanceof UnreadableBackupError) {
      showNotice(t('worldBackup.unreadable'));
      return;
    }
    console.error('[Atlas] Restoring a world backup failed:', error);
    showNotice(t('worldBackup.restoreFailed'));
  }
}
