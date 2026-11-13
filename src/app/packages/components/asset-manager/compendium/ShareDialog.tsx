import React, { useId, useState } from 'react';
import type { NamedPlayer, PageShares, ShareAccess } from '../../../../players/shares';
import { SettingsDialog } from '../../../../react/components/collection-settings/SettingsDialog';
import { t } from '../../../../i18n';

/** What the GM picks for one player: an access, none, or (for pages shared unlike) what each has. */
type Choice = ShareAccess | 'none' | 'mixed';

interface ShareDialogProps {
  /** The players of the table, in the order they are listed. */
  players: readonly NamedPlayer[];
  shares: PageShares;
  /** The notes to share, by vault path: one, or the GM's selection. */
  paths: readonly string[];
  /** The name of the one note shared, or null for several. */
  name: string | null;
  /** Stores the choice: for each player whose choice changed, an access or null for none. */
  onSave: (changes: Readonly<Record<string, ShareAccess | null>>) => Promise<void>;
  onClose: () => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** What each player has of `paths` now: one access, none, or `mixed` where the pages differ. */
function choicesOf(players: readonly NamedPlayer[], shares: PageShares, paths: readonly string[]): Record<string, Choice> {
  const choices: Record<string, Choice> = {};
  for (const { id } of players) {
    const accesses = new Set(paths.map((path) => shares.shares[path]?.[id] ?? 'none'));
    choices[id] = accesses.size === 1 ? [...accesses][0] ?? 'none' : 'mixed';
  }
  return choices;
}

/**
 * Who the pages are shared with: each player of the table, connected or not, reads them, reads
 * and changes them, or has none of them. Several pages shared unlike start at "as each is", which changes
 * nothing for that player.
 */
export function ShareDialog({ players, shares, paths, name, onSave, onClose }: ShareDialogProps): React.ReactElement {
  const headingId = useId();
  const [initial] = useState(() => choicesOf(players, shares, paths));
  const [choices, setChoices] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (busy) return;
    const changes: Record<string, ShareAccess | null> = {};
    for (const [id, choice] of Object.entries(choices)) {
      if (choice === initial[id] || choice === 'mixed') continue;
      changes[id] = choice === 'none' ? null : choice;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(changes);
      onClose();
    } catch (failure) {
      console.error('[ShareDialog] Sharing failed:', failure);
      setError(t('compendium.share.failed', { error: messageOf(failure) }));
      setBusy(false);
    }
  };

  return (
    <SettingsDialog
      title={name === null ? t('compendium.share.titleMany', { count: paths.length }) : t('compendium.share.title', { name })}
      closeLabel={t('compendium.share.close')}
      canSave={!busy && players.length > 0}
      onSave={() => { void save(); }}
      onClose={() => { if (!busy) onClose(); }}
    >
      <form className="atlas-compendium-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <p className="atlas-compendium-form__hint" id={headingId}>{t('compendium.share.hint')}</p>
        {players.length === 0 && <p className="atlas-compendium-form__hint">{t('compendium.share.noPlayers')}</p>}
        {players.map(({ id, name: playerName }) => (
          <label key={id} className="atlas-compendium-form__field atlas-compendium-share__player">
            <span>{playerName}</span>
            <select
              className="dropdown"
              aria-label={t('compendium.share.accessOf', { name: playerName })}
              value={choices[id] ?? 'none'}
              disabled={busy}
              onChange={(event) => setChoices({ ...choices, [id]: event.target.value as Choice })}
            >
              {initial[id] === 'mixed' && <option value="mixed">{t('compendium.share.mixed')}</option>}
              <option value="none">{t('compendium.share.none')}</option>
              <option value="read">{t('compendium.share.read')}</option>
              <option value="write">{t('compendium.share.write')}</option>
            </select>
          </label>
        ))}
        {error !== null && <p className="atlas-compendium-form__error" role="alert">{error}</p>}
      </form>
    </SettingsDialog>
  );
}
