import React, { useId, useState } from 'react';
import { isFolderName } from '../../../../compendium/sourceFormat';
import { SettingsDialog } from '../../../../react/components/collection-settings/SettingsDialog';
import { t } from '../../../../i18n';

/** The value of the system list that asks for a system of another name. */
const OTHER_SYSTEM = '';

interface NewBookDialogProps {
  /** The names of the game systems the vault has books of. */
  systems: readonly string[];
  initialSystem: string | null;
  /** Makes the book; throws with a message when it cannot. */
  onCreate: (systemName: string, bookName: string) => Promise<void>;
  onClose: () => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** A new book of the GM's own: its game system, one the vault has or a new one, and its name. */
export function NewBookDialog({ systems, initialSystem, onCreate, onClose }: NewBookDialogProps): React.ReactElement {
  const ids = { system: useId(), systemName: useId(), name: useId() };
  const [system, setSystem] = useState(() => (initialSystem !== null && systems.includes(initialSystem) ? initialSystem : systems[0] ?? OTHER_SYSTEM));
  const [systemName, setSystemName] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosenSystem = (system === OTHER_SYSTEM ? systemName : system).trim();
  const namesOk = isFolderName(chosenSystem) && isFolderName(name.trim());
  const typed = name.trim() !== '' && (system !== OTHER_SYSTEM || systemName.trim() !== '');

  const save = async (): Promise<void> => {
    if (busy || !namesOk) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(chosenSystem, name.trim());
      onClose();
    } catch (failure) {
      console.error('[NewBookDialog] Making the book failed:', failure);
      setError(t('compendium.newBook.failed', { error: messageOf(failure) }));
      setBusy(false);
    }
  };

  return (
    <SettingsDialog
      title={t('compendium.newBook.title')}
      closeLabel={t('compendium.newBook.close')}
      canSave={!busy && namesOk}
      onSave={() => { void save(); }}
      onClose={() => { if (!busy) onClose(); }}
    >
      <form className="atlas-compendium-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="atlas-compendium-form__hint">{t('compendium.newBook.hint')}</p>
        <label className="atlas-compendium-form__field" htmlFor={ids.system}>
          <span>{t('compendium.newBook.system')}</span>
          <select id={ids.system} className="dropdown" value={system} disabled={busy} onChange={(event) => setSystem(event.target.value)}>
            {systems.map((option) => <option key={option} value={option}>{option}</option>)}
            <option value={OTHER_SYSTEM}>{t('compendium.newBook.newSystem')}</option>
          </select>
        </label>
        {system === OTHER_SYSTEM && (
          <label className="atlas-compendium-form__field" htmlFor={ids.systemName}>
            <span>{t('compendium.newBook.systemName')}</span>
            <input id={ids.systemName} type="text" value={systemName} disabled={busy} onChange={(event) => setSystemName(event.target.value)} />
          </label>
        )}
        <label className="atlas-compendium-form__field" htmlFor={ids.name}>
          <span>{t('compendium.newBook.name')}</span>
          <input id={ids.name} type="text" value={name} disabled={busy} autoFocus onChange={(event) => setName(event.target.value)} />
        </label>
        {typed && !namesOk && <p className="atlas-compendium-form__error">{t('compendium.newBook.badName')}</p>}
        {error !== null && <p className="atlas-compendium-form__error" role="alert">{error}</p>}
      </form>
    </SettingsDialog>
  );
}
