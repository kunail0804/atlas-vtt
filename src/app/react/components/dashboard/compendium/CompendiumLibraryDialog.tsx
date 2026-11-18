import React from 'react';
import type { App } from 'obsidian';
import { Trash2 } from 'lucide-react';
import { OFFICIAL_SOURCES } from '../../../../compendium/officialSources';
import { sourceTree, type BookChoice } from '../../../../compendium/sourceTree';
import { Button } from '../../../../packages/components/primitives/button';
import { t } from '../../../../i18n';
import { SettingsDialog } from '../../collection-settings/SettingsDialog';
import { BookStateTag } from './BookStateTag';
import { useInstalledSources } from './useInstalledSources';
import { useSourceInstalls } from './useSourceInstalls';

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

interface CompendiumLibraryDialogProps {
  app: App;
  onClose: () => void;
}

/**
 * The vault's compendium sources, whatever world uses them: Atlas' sources to download or update,
 * every installed one to remove, and a zip file to install. Each action takes effect at once; a
 * world then chooses among the installed sources (`CompendiumSourcesDialog`).
 */
export function CompendiumLibraryDialog({ app, onClose }: CompendiumLibraryDialogProps): React.ReactElement {
  const { sources } = useInstalledSources(app);
  const installs = useSourceInstalls(app);
  const tree = sources === undefined ? [] : sourceTree(OFFICIAL_SOURCES, sources);
  const busy = installs.busy !== null;

  const action = (book: BookChoice): React.ReactNode => {
    const { state } = book;
    if (state.kind === 'installed') return null;
    const label = state.kind === 'available' ? t('compendium.downloadBook', { name: book.name }) : t('compendium.updateBook', { name: book.name });
    return (
      <Button variant="outline" size="sm" aria-label={label} disabled={busy} onClick={() => { void installs.download([state.official]); }}>
        {state.kind === 'available' ? t('compendium.download', { size: megabytes(state.official.size) }) : t('compendium.update')}
      </Button>
    );
  };

  return (
    <SettingsDialog
      title={t('compendium.libraryTitle')}
      closeLabel={t('compendium.close')}
      canSave={!busy}
      onClose={() => { if (!busy) onClose(); }}
    >
      <div className="compendium-sources">
        <p className="compendium-sources__intro">{t('compendium.libraryIntro')}</p>
        {sources === undefined && <p className="compendium-sources__status">{t('compendium.loading')}</p>}
        {tree.map((system) => (
          <section key={system.id} className="compendium-sources__system" aria-label={system.name}>
            <span className="compendium-sources__system-name">{system.name}</span>
            <ul className="compendium-sources__books">
              {system.books.map((book) => (
                <li key={book.id} className="compendium-sources__book">
                  <span className="compendium-sources__book-name compendium-sources__book-label">{book.name}</span>
                  {book.personal && <span className="atlas-csm-tag">{t('compendium.personal')}</span>}
                  {book.state.kind !== 'available' && <BookStateTag book={book} />}
                  {action(book)}
                  {book.state.kind !== 'available' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="compendium-sources__remove"
                      aria-label={t('compendium.remove', { name: book.name })}
                      disabled={busy}
                      onClick={() => { void installs.remove(book.id, book.name); }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        <div className="compendium-sources__actions">
          <Button variant="outline" disabled={busy} onClick={() => { void installs.installFile(); }}>{t('compendium.installFile')}</Button>
        </div>
        {installs.busy !== null && <p className="compendium-sources__status" role="status">{installs.busy}</p>}
        {installs.error !== null && <p className="compendium-sources__error" role="alert">{installs.error}</p>}
      </div>
    </SettingsDialog>
  );
}
