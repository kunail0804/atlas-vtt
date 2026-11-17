import React, { useState } from 'react';
import type { App } from 'obsidian';
import { AnimatePresence } from 'framer-motion';
import type { Campaign } from '../../../../campaigns/campaignTypes';
import type { CampaignService } from '../../../../campaigns/CampaignService';
import { OFFICIAL_SOURCES } from '../../../../compendium/officialSources';
import { PERSONAL_BOOK_ID, installedTree, isPersonalBookId, personalBooksFor, sourceTree, systemSelection, toggleBook, toggleSystem } from '../../../../compendium/sourceTree';
import { CompendiumService } from '../../../../compendium/CompendiumService';
import { Button } from '../../../../packages/components/primitives/button';
import { t } from '../../../../i18n';
import { describeError } from '../../../../utils/errors';
import { SettingsDialog } from '../../collection-settings/SettingsDialog';
import { BookStateTag } from './BookStateTag';
import { CompendiumLibraryDialog } from './CompendiumLibraryDialog';
import { SystemCheckbox } from './SystemCheckbox';
import { useInstalledSources } from './useInstalledSources';

interface CompendiumSourcesDialogProps {
  app: App;
  campaign: Campaign;
  service: CampaignService;
  onClose: () => void;
}

/**
 * The compendium sources a campaign uses, among those the vault has installed: game systems, then
 * their books, ticked as a whole or book by book. Installing, updating and removing a source is the
 * vault's (`CompendiumLibraryDialog`), which this dialog opens.
 */
export function CompendiumSourcesDialog({ app, campaign, service, onClose }: CompendiumSourcesDialogProps): React.ReactElement {
  const { sources } = useInstalledSources(app);
  // The Personal books are Atlas' to add: the GM chooses the others.
  const [chosen, setChosen] = useState<Set<string>>(() => new Set((campaign.sources ?? []).filter((id) => !isPersonalBookId(id))));
  const tree = sources === undefined ? [] : installedTree(sourceTree(OFFICIAL_SOURCES, sources));
  const known = new Set(tree.flatMap((system) => system.books.map((book) => book.id)));
  const missing = sources === undefined ? [] : [...chosen].filter((id) => !known.has(id));
  const [saving, setSaving] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  /** Why making a personal book or saving the campaign's choice failed; null while nothing did. */
  const [saveError, setSaveError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const own: string[] = [];
      try {
        for (const system of personalBooksFor(tree, chosen)) {
          own.push(await CompendiumService.forApp(app).ensurePersonalBook(system, { id: PERSONAL_BOOK_ID, name: t('compendium.personalBook') }));
        }
      } catch (error) {
        console.error('[CompendiumSourcesDialog] Making a personal book failed:', error);
        setSaveError(t('compendium.personalFailed', { error: describeError(error) }));
        return;
      }
      try {
        await service.save(campaign.id, { sources: [...chosen, ...own] });
      } catch (error) {
        console.error('[CompendiumSourcesDialog] Saving the campaign sources failed:', error);
        setSaveError(t('compendium.saveFailed', { error: describeError(error) }));
        return;
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SettingsDialog
        title={t('compendium.dialogTitle', { name: campaign.name })}
        closeLabel={t('compendium.close')}
        canSave={!saving && sources !== undefined}
        onSave={() => { void save(); }}
        // Escape closes the vault's dialog above this one, never both.
        onClose={() => { if (!saving && !libraryOpen) onClose(); }}
      >
        <div className="compendium-sources">
          <p className="compendium-sources__intro">{t('compendium.intro')}</p>
          <p className="compendium-sources__intro">{t('compendium.personalIntro')}</p>
          {sources === undefined && <p className="compendium-sources__status">{t('compendium.loading')}</p>}
          {sources !== undefined && tree.length === 0 && <p className="compendium-sources__status">{t('compendium.noneInstalled')}</p>}
          {tree.map((system) => (
            <section key={system.id} className="compendium-sources__system" aria-label={system.name}>
              <label className="compendium-sources__system-row">
                <SystemCheckbox
                  selection={systemSelection(system, chosen)}
                  label={t('compendium.allOf', { name: system.name })}
                  disabled={saving}
                  onToggle={() => setChosen(toggleSystem(system, chosen))}
                />
                <span className="compendium-sources__system-name">{system.name}</span>
              </label>
              <ul className="compendium-sources__books">
                {system.books.map((book) => (
                  <li key={book.id} className="compendium-sources__book">
                    <label className="compendium-sources__book-label">
                      <input type="checkbox" checked={chosen.has(book.id)} disabled={saving} onChange={() => setChosen(toggleBook(book.id, chosen))} />
                      <span className="compendium-sources__book-name">{book.name}</span>
                    </label>
                    {book.personal && <span className="atlas-csm-tag">{t('compendium.personal')}</span>}
                    <BookStateTag book={book} />
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
                      <input type="checkbox" checked disabled={saving} onChange={() => setChosen(toggleBook(id, chosen))} />
                      <span className="compendium-sources__book-name">{id}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <div className="compendium-sources__actions">
            <Button variant="outline" disabled={saving} onClick={() => setLibraryOpen(true)}>{t('compendium.manage')}</Button>
          </div>
          {saveError !== null && <p className="compendium-sources__error" role="alert">{saveError}</p>}
        </div>
      </SettingsDialog>
      <AnimatePresence>
        {libraryOpen && <CompendiumLibraryDialog key="library" app={app} onClose={() => setLibraryOpen(false)} />}
      </AnimatePresence>
    </>
  );
}
