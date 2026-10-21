import { useState } from 'react';
import type { App } from 'obsidian';
import { showNotice } from '../../../../ui/notice';
import { CompendiumService } from '../../../../compendium/CompendiumService';
import type { OfficialSource } from '../../../../compendium/officialSources';
import type { InstallResult } from '../../../../compendium/sourceInstall';
import { confirmAction } from '../../../../ui/confirmDialog';
import { t } from '../../../../i18n';

export interface SourceInstalls {
  /** What is running, shown to the GM; null while idle. */
  busy: string | null;
  error: string | null;
  /** Downloads and installs every source in turn; false when one failed (the rest are not tried). */
  download: (sources: readonly OfficialSource[]) => Promise<boolean>;
  /** Asks for a zip file and installs it; the source's id, or null when nothing was installed. */
  installFile: () => Promise<string | null>;
  /** Asks the GM, then removes the source; whether it was removed. */
  remove: (id: string, name: string) => Promise<boolean>;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function noticeFor(result: InstallResult): void {
  const kept = result.kept.length;
  showNotice(kept === 0 ? t('compendium.installedPlain', { name: result.name }) : t('compendium.installedNotice', { name: result.name, count: kept }));
}

/** Opens the system's file chooser for a zip; resolves with the file, or null when the GM cancels. */
function chooseZip(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.body.createEl('input', { type: 'file', cls: 'atlas-hidden-file-input', attr: { accept: '.zip' } });
    input.addEventListener('change', () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    input.click();
  });
}

/** Installing and removing compendium sources from the source picker, one at a time. */
export function useSourceInstalls(app: App): SourceInstalls {
  const service = CompendiumService.forApp(app);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (sources: readonly OfficialSource[]): Promise<boolean> => {
    setError(null);
    for (const source of sources) {
      const name = source.book.name;
      try {
        setBusy(t('compendium.downloading', { name }));
        const result = await service.installOfficial(source, (done, total) => setBusy(t('compendium.installing', { name, done, total })));
        noticeFor(result);
      } catch (failure) {
        console.error(`[useSourceInstalls] Installing ${source.id} failed:`, failure);
        setError(t('compendium.failed', { name, error: messageOf(failure) }));
        setBusy(null);
        return false;
      }
    }
    setBusy(null);
    return true;
  };

  const installFile = async (): Promise<string | null> => {
    const file = await chooseZip();
    if (!file) return null;
    setError(null);
    try {
      setBusy(t('compendium.installing', { name: file.name, done: 0, total: '…' }));
      const result = await service.installFile(file, (done, total) => setBusy(t('compendium.installing', { name: file.name, done, total })));
      noticeFor(result);
      return result.id;
    } catch (failure) {
      console.error('[useSourceInstalls] Installing a source file failed:', failure);
      setError(t('compendium.failed', { name: file.name, error: messageOf(failure) }));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string, name: string): Promise<boolean> => {
    const confirmed = await confirmAction({
      title: t('compendium.removeTitle', { name }),
      message: [t('compendium.removeMessage')],
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return false;
    setError(null);
    try {
      const result = await service.remove(id);
      showNotice(t('compendium.removedNotice', { name, count: result?.kept.length ?? 0 }));
      return true;
    } catch (failure) {
      console.error(`[useSourceInstalls] Removing ${id} failed:`, failure);
      setError(t('compendium.removeFailed', { name, error: messageOf(failure) }));
      return false;
    }
  };

  return { busy, error, download, installFile, remove };
}
