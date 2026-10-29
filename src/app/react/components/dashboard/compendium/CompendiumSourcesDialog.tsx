import React, { useState } from 'react';
import type { App } from 'obsidian';
import { Trash2 } from 'lucide-react';
import type { Campaign } from '../../../../campaigns/campaignTypes';
import type { CampaignService } from '../../../../campaigns/CampaignService';
import { OFFICIAL_SOURCES } from '../../../../compendium/officialSources';
import { booksToMake, downloadsFor, sourceTree, systemSelection, toggleBook, toggleSystem, type BookChoice } from '../../../../compendium/sourceTree';
import { CompendiumService } from '../../../../compendium/CompendiumService';
import { Button } from '../../../../packages/components/primitives/button';
import { t } from '../../../../i18n';
import { SettingsDialog } from '../../collection-settings/SettingsDialog';
import { SystemCheckbox } from './SystemCheckbox';
import { useInstalledSources } from './useInstalledSources';
import { useSourceInstalls } from './useSourceInstalls';

interface CompendiumSourcesDialogProps {
  app: App;
  campaign: Campaign;
  service: CampaignService;
  onClose: () => void;
}

const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

function stateLabel(book: BookChoice): string {
  if (book.state.kind === 'new') return t('compendium.personalNew');
  if (book.state.kind === 'available') return t('compendium.download', { size: megabytes(book.state.official.size) });
  return book.state.kind === 'outdated' ? t('compendium.outdated') : t('compendium.installed');
}

/**
 * The compendium sources a campaign uses: game systems, then their books, ticked as a whole or
 * book by book. Saving downloads what the vault lacks, then stores the campaign's choice.
 */
export function CompendiumSourcesDialog({ app, campaign, service, onClose }: CompendiumSourcesDialogProps): React.ReactElement {
  const { sources } = useInstalledSources(app);
  const installs = useSourceInstalls(app);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(campaign.sources ?? []));
  const tree = sources === undefined ? [] : sourceTree(OFFICIAL_SOURCES, sources, t('compendium.personalBook'));
  const known = new Set(tree.flatMap((system) => system.books.map((book) => book.id)));
  const missing = sources === undefined ? [] : [...chosen].filter((id) => !known.has(id));
  const busy = installs.busy !== null;

  const [makeError, setMakeError] = useState<string | null>(null);

  const toggleMissing = (id: string): void => {
    const next = new Set(chosen);
    if (!next.delete(id)) next.add(id);
    setChosen(next);
  };

  const save = async (): Promise<void> => {
    if (busy) return;
    if (!(await installs.download(downloadsFor(tree, chosen)))) return;
    setMakeError(null);
    try {
      for (const { system, book } of booksToMake(tree, chosen)) await CompendiumService.forApp(app).ensurePersonalBook(system, book);
    } catch (error) {
      console.error('[CompendiumSourcesDialog] Making a personal book failed:', error);
      setMakeError(t('compendium.personalFailed', { error: error instanceof Error ? error.message : String(error) }));
      return;
    }
    try {
      service.update(campaign.id, { sources: [...chosen] });
      onClose();
    } catch (error) {
      console.error('[CompendiumSourcesDialog] Saving the campaign sources failed:', error);
    }
  };

  const installFile = async (): Promise<void> => {
    const id = await installs.installFile();
    if (id !== null) setChosen((current) => new Set(current).add(id));
  };

  const removeBook = async (book: BookChoice): Promise<void> => {
    if (!(await installs.remove(book.id, book.name))) return;
    setChosen((current) => {
      const next = new Set(current);
      next.delete(book.id);
      return next;
    });
  };

  return (
    <SettingsDialog
      title={t('compendium.dialogTitle', { name: campaign.name })}
      closeLabel={t('compendium.close')}
      canSave={!busy && sources !== undefined}
      onSave={() => { void save(); }}
      onClose={() => { if (!busy) onClose(); }}
    >
      <div className="compendium-sources">
        <p className="compendium-sources__intro">{t('compendium.intro')}</p>
        <p className="compendium-sources__intro">{t('compendium.personalIntro')}</p>
        {sources === undefined && <p className="compendium-sources__status">{t('compendium.loading')}</p>}
        {tree.map((system) => (
          <section key={system.id} className="compendium-sources__system" aria-label={system.name}>
            <label className="compendium-sources__system-row">
              <SystemCheckbox
                selection={systemSelection(system, chosen)}
                label={t('compendium.allOf', { name: system.name })}
                disabled={busy}
                onToggle={() => setChosen(toggleSystem(system, chosen))}
              />
              <span className="compendium-sources__system-name">{system.name}</span>
            </label>
            <ul className="compendium-sources__books">
              {system.books.map((book) => (
                <li key={book.id} className="compendium-sources__book">
                  <label className="compendium-sources__book-label">
                    <input type="checkbox" checked={chosen.has(book.id)} disabled={busy} onChange={() => setChosen(toggleBook(system, book.id, chosen))} />
                    <span className="compendium-sources__book-name">{book.name}</span>
                  </label>
                  {book.personal && <span className="atlas-csm-tag">{t('compendium.personal')}</span>}
                  <span className={`atlas-csm-tag${book.state.kind === 'outdated' ? ' atlas-csm-tag--accent' : ''}`}>{stateLabel(book)}</span>
                  {book.state.kind !== 'available' && book.state.kind !== 'new' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="compendium-sources__remove"
                      aria-label={t('compendium.remove', { name: book.name })}
                      disabled={busy}
                      onClick={() => { void removeBook(book); }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
        {missing.length > 0 && (
          <section className="compendium-sources__system" aria-label={t('compendium.missing')}>
            <span className="compendium-sources__system-name">{t('compendium.missing')}</span>
            <p className="compendium-sources__status">{t('compendium.missingHint')}</p>
            <ul className="compendium-sources__books">
              {missing.map((id) => (
                <li key={id} className="compendium-sources__book">
                  <label className="compendium-sources__book-label">
                    <input type="checkbox" checked disabled={busy} onChange={() => toggleMissing(id)} />
                    <span className="compendium-sources__book-name">{id}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}
        <div className="compendium-sources__actions">
          <Button variant="outline" disabled={busy} onClick={() => { void installFile(); }}>{t('compendium.installFile')}</Button>
        </div>
        {installs.busy !== null && <p className="compendium-sources__status" role="status">{installs.busy}</p>}
        {installs.error !== null && <p className="compendium-sources__error" role="alert">{installs.error}</p>}
        {makeError !== null && <p className="compendium-sources__error" role="alert">{makeError}</p>}
      </div>
    </SettingsDialog>
  );
}
