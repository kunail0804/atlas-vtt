import React, { useId, useState } from 'react';
import type { CompendiumBook } from '../../../../compendium/compendiumEntries';
import { SettingsDialog } from '../../../../react/components/collection-settings/SettingsDialog';
import { t } from '../../../../i18n';

interface CopyDialogProps {
  /** The books entries may be copied into: the GM's own. */
  books: readonly CompendiumBook[];
  count: number;
  onCopy: (book: CompendiumBook) => Promise<void>;
  onClose: () => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Copies the ticked entries into one of the GM's books, where they can be changed. */
export function CopyDialog({ books, count, onCopy, onClose }: CopyDialogProps): React.ReactElement {
  const id = useId();
  const [bookId, setBookId] = useState(books[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const book = books.find((candidate) => candidate.id === bookId);

  const save = async (): Promise<void> => {
    if (busy || !book) return;
    setBusy(true);
    setError(null);
    try {
      await onCopy(book);
      onClose();
    } catch (failure) {
      console.error('[CopyDialog] Copying the entries failed:', failure);
      setError(t('compendium.copy.failed', { error: messageOf(failure) }));
      setBusy(false);
    }
  };

  return (
    <SettingsDialog
      title={t('compendium.copy.title', { count })}
      closeLabel={t('compendium.copy.close')}
      canSave={!busy && book !== undefined}
      onSave={() => { void save(); }}
      onClose={() => { if (!busy) onClose(); }}
    >
      <form className="atlas-compendium-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="atlas-compendium-form__hint">{t('compendium.copy.hint')}</p>
        {books.length === 0 && <p className="atlas-compendium-form__hint">{t('compendium.copy.noBook')}</p>}
        {books.length > 0 && (
          <label className="atlas-compendium-form__field" htmlFor={id}>
            <span>{t('compendium.copy.book')}</span>
            <select id={id} className="dropdown" value={bookId} disabled={busy} onChange={(event) => setBookId(event.target.value)}>
              {books.map((option) => <option key={option.id} value={option.id}>{`${option.systemName} · ${option.name}`}</option>)}
            </select>
          </label>
        )}
        {error !== null && <p className="atlas-compendium-form__error" role="alert">{error}</p>}
      </form>
    </SettingsDialog>
  );
}
