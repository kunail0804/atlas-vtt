import { t } from '../i18n';
import { showNotice } from '../ui/notice';
import type { TableFileBlock } from './TableFile';

/** How long a table file stays unreadable before the GM is told: a sync that writes it in two steps mends it sooner. */
export const UNREADABLE_WARNING_MS = 3_000;

/** What the warning needs of a table file. */
export interface WatchedTableFile {
  readonly path: string;
  blocked(): TableFileBlock | null;
  onChange(listener: () => void): () => void;
}

/** What the GM reads where the table's file at `path` cannot be read. */
export const unreadableText = (path: string): string => t('online.seats.unreadable', { file: path });

/**
 * Tells the GM once when the table's file cannot be read for `UNREADABLE_WARNING_MS`, and again only
 * after it was read since. Returns the way to stop.
 */
export function warnWhenUnreadable(file: WatchedTableFile): () => void {
  let timer: number | null = null;
  let warned = false;
  const check = (): void => {
    if (file.blocked() !== 'unreadable') {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      warned = false;
      return;
    }
    if (warned || timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      if (file.blocked() !== 'unreadable') return;
      warned = true;
      showNotice(unreadableText(file.path));
    }, UNREADABLE_WARNING_MS);
  };
  const stop = file.onChange(check);
  check();
  return () => {
    stop();
    if (timer !== null) window.clearTimeout(timer);
  };
}
