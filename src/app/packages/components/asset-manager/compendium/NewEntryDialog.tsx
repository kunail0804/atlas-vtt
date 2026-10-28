import React, { useId, useState } from 'react';
import type { CompendiumBook } from '../../../../compendium/compendiumEntries';
import { OFFICIAL_SOURCES } from '../../../../compendium/officialSources';
import { ENTRY_KINDS, MONSTER_TEMPLATES, isEntryKind, type EntryKind } from '../../../../compendium/sourceFormat';
import { SettingsDialog } from '../../../../react/components/collection-settings/SettingsDialog';
import { t } from '../../../../i18n';

interface NewEntryDialogProps {
  books: readonly CompendiumBook[];
  initialBookId: string | null;
  initialKind: EntryKind | null;
  /** Makes the entry; throws with a message when it cannot. */
  onCreate: (book: CompendiumBook, kind: EntryKind, name: string) => Promise<void>;
  onClose: () => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A new entry: its name, its kind and the book it goes in. */
export function NewEntryDialog({ books, initialBookId, initialKind, onCreate, onClose }: NewEntryDialogProps): React.ReactElement {
  const ids = { name: useId(), kind: useId(), book: useId() };
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EntryKind>(initialKind ?? 'monster');
  const [bookId, setBookId] = useState(() => books.find((book) => book.id === initialBookId)?.id ?? books[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const book = books.find((candidate) => candidate.id === bookId);
  const isAtlasBook = book !== undefined && OFFICIAL_SOURCES.some((source) => source.id === book.id);
  const isStatblock = book !== undefined && kind === 'monster' && MONSTER_TEMPLATES[book.systemId] !== undefined;

  const save = async (): Promise<void> => {
    if (busy || !book || name.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(book, kind, name);
      onClose();
    } catch (failure) {
      console.error('[NewEntryDialog] Making the entry failed:', failure);
      setError(t('compendium.newEntry.failed', { error: messageOf(failure) }));
      setBusy(false);
    }
  };

  return (
    <SettingsDialog
      title={t('compendium.newEntry.title')}
      closeLabel={t('compendium.newEntry.close')}
      canSave={!busy && book !== undefined && name.trim() !== ''}
      onSave={() => { void save(); }}
      onClose={() => { if (!busy) onClose(); }}
    >
      <form className="atlas-compendium-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label className="atlas-compendium-form__field" htmlFor={ids.name}>
          <span>{t('compendium.newEntry.name')}</span>
          <input id={ids.name} type="text" value={name} disabled={busy} autoFocus onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="atlas-compendium-form__field" htmlFor={ids.kind}>
          <span>{t('compendium.newEntry.kind')}</span>
          <select id={ids.kind} className="dropdown" value={kind} disabled={busy} onChange={(event) => { if (isEntryKind(event.target.value)) setKind(event.target.value); }}>
            {ENTRY_KINDS.map((option) => <option key={option} value={option}>{t(`compendium.kind.${option}`)}</option>)}
          </select>
        </label>
        <label className="atlas-compendium-form__field" htmlFor={ids.book}>
          <span>{t('compendium.newEntry.book')}</span>
          <select id={ids.book} className="dropdown" value={bookId} disabled={busy} onChange={(event) => setBookId(event.target.value)}>
            {books.map((option) => <option key={option.id} value={option.id}>{`${option.systemName} · ${option.name}`}</option>)}
          </select>
        </label>
        {isStatblock && <p className="atlas-compendium-form__hint">{t('compendium.newEntry.statblock')}</p>}
        {isAtlasBook && <p className="atlas-compendium-form__hint">{t('compendium.newEntry.atlasBook')}</p>}
        {error !== null && <p className="atlas-compendium-form__error" role="alert">{error}</p>}
      </form>
    </SettingsDialog>
  );
}
