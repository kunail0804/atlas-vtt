import React, { useId, useState } from 'react';
import { playerNameOf, type Roster } from '../../../../players/roster';
import { SettingsDialog } from '../../../../react/components/collection-settings/SettingsDialog';
import { t } from '../../../../i18n';

/** The value of the merge list that merges with nobody. */
const NOBODY = '';

interface PlayerDialogProps {
  roster: Roster;
  /** The player changed; null makes a new one. */
  playerId: string | null;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  /** `id` is the same person as `into`, who takes their devices and pages. */
  onMerge: (id: string, into: string) => Promise<void>;
  onClose: () => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * A player of the vault: a new one, whose first device to join under that name becomes theirs, or
 * one to rename, or to merge into another (the same person joined from another device).
 */
export function PlayerDialog({ roster, playerId, onCreate, onRename, onMerge, onClose }: PlayerDialogProps): React.ReactElement {
  const ids = { name: useId(), merge: useId() };
  const player = playerId === null ? undefined : roster.players[playerId];
  const [name, setName] = useState(player?.name ?? '');
  const [into, setInto] = useState(NOBODY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = Object.entries(roster.players).filter(([id]) => id !== playerId).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const canSave = !busy && (into !== NOBODY || playerNameOf(name) !== null);

  const save = async (): Promise<void> => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      if (playerId === null) await onCreate(name);
      else if (into !== NOBODY) await onMerge(playerId, into);
      else await onRename(playerId, name);
      onClose();
    } catch (failure) {
      console.error('[PlayerDialog] Saving the player failed:', failure);
      setError(t('compendium.player.failed', { error: messageOf(failure) }));
      setBusy(false);
    }
  };

  return (
    <SettingsDialog
      title={playerId === null ? t('compendium.player.newTitle') : t('compendium.player.editTitle', { name: player?.name ?? '' })}
      closeLabel={t('compendium.player.close')}
      canSave={canSave}
      onSave={() => { void save(); }}
      onClose={() => { if (!busy) onClose(); }}
    >
      <form className="atlas-compendium-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="atlas-compendium-form__hint">{playerId === null ? t('compendium.player.newHint') : t('compendium.player.editHint', { count: player?.devices.length ?? 0 })}</p>
        <label className="atlas-compendium-form__field" htmlFor={ids.name}>
          <span>{t('compendium.player.name')}</span>
          <input id={ids.name} type="text" value={name} disabled={busy || into !== NOBODY} autoFocus onChange={(event) => setName(event.target.value)} />
        </label>
        {playerId !== null && others.length > 0 && (
          <label className="atlas-compendium-form__field" htmlFor={ids.merge}>
            <span>{t('compendium.player.merge')}</span>
            <select id={ids.merge} className="dropdown" value={into} disabled={busy} onChange={(event) => setInto(event.target.value)}>
              <option value={NOBODY}>{t('compendium.player.mergeNobody')}</option>
              {others.map(([id, other]) => <option key={id} value={id}>{other.name}</option>)}
            </select>
          </label>
        )}
        {into !== NOBODY && <p className="atlas-compendium-form__hint">{t('compendium.player.mergeHint')}</p>}
        {error !== null && <p className="atlas-compendium-form__error" role="alert">{error}</p>}
      </form>
    </SettingsDialog>
  );
}
