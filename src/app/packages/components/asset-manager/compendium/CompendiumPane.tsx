import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { TFile, type App } from 'obsidian';
import { AnimatePresence } from 'framer-motion';
import { BookPlus, FilePlus, Library, Search, Settings, Upload } from 'lucide-react';
import { CampaignFiles } from '../../../../campaigns/CampaignFiles';
import { CampaignPlay } from '../../../../campaigns/campaignPlay';
import { useCampaigns } from '../../../../campaigns/useCampaigns';
import { CompendiumService } from '../../../../compendium/CompendiumService';
import { exportCompendiumBook } from '../../../../compendium/compendiumFileMenu';
import { booksOf, entryMatches, groupCounts, type CompendiumBook, type CompendiumEntry, type EntryGroup } from '../../../../compendium/compendiumEntries';
import { OFFICIAL_SOURCES } from '../../../../compendium/officialSources';
import { ENTRY_KINDS, isEntryKind, type EntryKind } from '../../../../compendium/sourceFormat';
import { CompendiumSourcesDialog } from '../../../../react/components/dashboard/compendium/CompendiumSourcesDialog';
import { useInstalledSources } from '../../../../react/components/dashboard/compendium/useInstalledSources';
import { confirmAction } from '../../../../ui/confirmDialog';
import { showNotice } from '../../../../ui/notice';
import { Button } from '../../primitives/button';
import { LabelTooltip } from '../../primitives/tooltip';
import { t } from '../../../../i18n';
import { CompendiumEntryPreview } from './CompendiumEntryPreview';
import { NewBookDialog } from './NewBookDialog';
import { NewEntryDialog } from './NewEntryDialog';
import { useCompendiumEntries } from './useCompendiumEntries';

/** The value of the campaign list that shows every installed source, whatever campaign uses it. */
const WHOLE_VAULT = '';
const GROUPS: readonly EntryGroup[] = [...ENTRY_KINDS, 'other'];

type OpenDialog = 'sources' | 'entry' | 'book' | null;

interface CompendiumPaneProps {
  app: App;
  /** The asset type tabs, with Compendium among them, for the toolbar. */
  tabs: React.ReactNode;
  /** Closes the asset manager, once a note opens in the workspace. */
  onClose: () => void;
  /** Told whether one of the pane's dialogs is open, so the manager leaves the keyboard to it. */
  onDialogChange: (open: boolean) => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The compendium in the asset manager: a campaign's books, or every installed one, listed by
 * kind of entry with a search. The GM reads an entry beside the list, opens or deletes it, makes
 * entries and books of their own, chooses the campaign's sources and exports their own books.
 */
export function CompendiumPane({ app, tabs, onClose, onDialogChange }: CompendiumPaneProps): React.JSX.Element {
  const { service: campaignService, campaigns } = useCampaigns(CampaignFiles.forApp(app));
  const { sources: installed } = useInstalledSources(app);
  const play = CampaignPlay.forApp(app);
  const playing = useSyncExternalStore(useCallback((listener: () => void) => play.onChange(listener), [play]), () => play.playing());

  // Until the GM picks one: the campaign this device plays, else the most recent one, else the whole vault.
  const [chosenScope, setChosenScope] = useState<string | null>(null);
  const scopeCandidates = [chosenScope, playing, campaigns[0]?.id ?? null];
  const scope = scopeCandidates.find((id) => id !== null && (id === WHOLE_VAULT || campaigns.some((campaign) => campaign.id === id))) ?? WHOLE_VAULT;
  const campaign = campaigns.find((candidate) => candidate.id === scope) ?? null;

  const campaignSources = campaign?.sources;
  const books = useMemo(
    () => (installed === undefined ? [] : booksOf(installed, campaign ? campaignSources ?? [] : null)),
    [installed, campaign, campaignSources],
  );
  const missingCount = campaign && installed
    ? (campaignSources ?? []).filter((id) => !installed.some((source) => source.manifest.id === id)).length
    : 0;
  const entries = useCompendiumEntries(app, books);

  const [group, setGroup] = useState<EntryGroup | null>(null);
  const [chosenBookId, setChosenBookId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const dialogOpen = dialog !== null;
  useEffect(() => {
    onDialogChange(dialogOpen);
    return () => onDialogChange(false);
  }, [dialogOpen, onDialogChange]);

  const bookId = books.some((book) => book.id === chosenBookId) ? chosenBookId : null;
  const filter = { group, bookId, search };
  const shown = entries.filter((entry) => entryMatches(entry, filter));
  const counts = groupCounts(entries, filter);
  const bookCounts = new Map<string, number>();
  for (const entry of entries) bookCounts.set(entry.bookId, (bookCounts.get(entry.bookId) ?? 0) + 1);
  const selected = shown.find((entry) => entry.path === selectedPath) ?? null;
  const bookName = (id: string): string => books.find((book) => book.id === id)?.name ?? id;
  const systems = [...new Set((installed ?? []).map((source) => source.manifest.system.name))].sort((a, b) => a.localeCompare(b));
  const canChooseSources = campaign !== null && campaignService !== null && campaign.readOnly !== true;

  const changeScope = (next: string): void => {
    setChosenScope(next);
    setChosenBookId(null);
    setSelectedPath(null);
  };

  const openEntry = (entry: CompendiumEntry): void => {
    const file = app.vault.getAbstractFileByPath(entry.path);
    if (!(file instanceof TFile)) return;
    onClose();
    app.workspace.getLeaf('tab').openFile(file).catch((error: unknown) => console.error('[CompendiumPane] Opening the note failed:', error));
  };

  const deleteEntry = async (entry: CompendiumEntry): Promise<void> => {
    const file = app.vault.getAbstractFileByPath(entry.path);
    if (!(file instanceof TFile)) return;
    const confirmed = await confirmAction({
      title: t('compendium.browser.deleteTitle', { name: entry.name }),
      message: [t('compendium.browser.deleteMessage')],
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await app.fileManager.trashFile(file);
      if (selectedPath === entry.path) setSelectedPath(null);
    } catch (error) {
      console.error('[CompendiumPane] Deleting the note failed:', error);
      showNotice(t('compendium.browser.deleteFailed', { name: entry.name, error: messageOf(error) }));
    }
  };

  const createEntry = async (book: CompendiumBook, kind: EntryKind, name: string): Promise<void> => {
    const file = await CompendiumService.forApp(app).createEntry(book, kind, name);
    // Every filter that would hide the new entry lets it through.
    setGroup(null);
    setSearch('');
    setChosenBookId((current) => (current === null ? null : book.id));
    setSelectedPath(file.path);
  };

  const createBook = async (systemName: string, bookName: string): Promise<void> => {
    const id = await CompendiumService.forApp(app).createBook(systemName, bookName);
    // A campaign shows only the books it uses: the new book joins it.
    if (campaign && campaignService && campaign.readOnly !== true) {
      campaignService.update(campaign.id, { sources: [...(campaign.sources ?? []), id] });
    }
    setChosenBookId(id);
  };

  const emptyText = (() => {
    if (installed === undefined) return t('compendium.browser.loading');
    if (books.length === 0) return campaign ? t('compendium.browser.noBooks') : t('compendium.browser.noBooksVault');
    return t('compendium.browser.noEntries');
  })();

  return (
    <>
      <aside className="atlas-asset-manager-sidebar atlas-compendium-sidebar">
        <div className="atlas-asset-manager-sidebar-content">
          <div className="atlas-compendium-sidebar__section">
            <div className="atlas-section-title">{t('compendium.browser.campaign')}</div>
            <div className="atlas-compendium-sidebar__row">
              <select
                className="dropdown atlas-compendium-sidebar__campaign"
                aria-label={t('compendium.browser.campaign')}
                value={scope}
                onChange={(event) => changeScope(event.target.value)}
              >
                {campaigns.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                <option value={WHOLE_VAULT}>{t('compendium.browser.wholeVault')}</option>
              </select>
              {canChooseSources && (
                <LabelTooltip label={t('compendium.browser.sources')}>
                  <Button variant="ghost" size="icon" className="atlas-collection-header-btn" aria-label={t('compendium.browser.sources')} onClick={() => setDialog('sources')}>
                    <Settings />
                  </Button>
                </LabelTooltip>
              )}
            </div>
            {campaign?.readOnly === true && <p className="atlas-compendium-sidebar__hint">{t('compendium.browser.readOnly')}</p>}
            {missingCount > 0 && <p className="atlas-compendium-sidebar__hint">{t('compendium.browser.missing', { count: missingCount })}</p>}
          </div>

          <div className="atlas-compendium-sidebar__section">
            <div className="atlas-compendium-sidebar__heading">
              <div className="atlas-section-title">{t('compendium.browser.books')}</div>
              <LabelTooltip label={t('compendium.browser.newBook')}>
                <Button variant="ghost" size="icon" className="atlas-collection-header-btn" aria-label={t('compendium.browser.newBook')} onClick={() => setDialog('book')}>
                  <BookPlus />
                </Button>
              </LabelTooltip>
            </div>
            <div className="atlas-compendium-sidebar__list">
              <button type="button" className={`atlas-tag-button ${bookId === null ? 'atlas-active' : ''}`} aria-pressed={bookId === null} onClick={() => setChosenBookId(null)}>
                <Library className="atlas-tag-icon" />
                <span className="atlas-tag-text">{t('compendium.browser.allBooks')}</span>
                <span className="atlas-tag-count">{entries.length}</span>
              </button>
              {books.map((book) => {
                const personal = !OFFICIAL_SOURCES.some((source) => source.id === book.id);
                return (
                  <div key={book.id} className="atlas-compendium-sidebar__book">
                    <LabelTooltip label={`${book.systemName} · ${book.name}`} describe>
                      <button
                        type="button"
                        className={`atlas-tag-button ${bookId === book.id ? 'atlas-active' : ''}`}
                        aria-pressed={bookId === book.id}
                        onClick={() => setChosenBookId(book.id)}
                      >
                        <span className="atlas-tag-text">{book.name}</span>
                        <span className="atlas-tag-count">{bookCounts.get(book.id) ?? 0}</span>
                      </button>
                    </LabelTooltip>
                    {personal && (
                      <LabelTooltip label={t('compendium.browser.exportBook', { name: book.name })}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="atlas-collection-header-btn"
                          aria-label={t('compendium.browser.exportBook', { name: book.name })}
                          onClick={() => { void exportCompendiumBook(app, book.root); }}
                        >
                          <Upload />
                        </Button>
                      </LabelTooltip>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="atlas-compendium-sidebar__section">
            <div className="atlas-section-title">{t('compendium.browser.kinds')}</div>
            <div className="atlas-compendium-sidebar__list">
              <button type="button" className={`atlas-tag-button ${group === null ? 'atlas-active' : ''}`} aria-pressed={group === null} onClick={() => setGroup(null)}>
                <span className="atlas-tag-text">{t('compendium.browser.allKinds')}</span>
              </button>
              {GROUPS.filter((option) => (counts.get(option) ?? 0) > 0 || option === group).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`atlas-tag-button ${group === option ? 'atlas-active' : ''}`}
                  aria-pressed={group === option}
                  onClick={() => setGroup(option)}
                >
                  <span className="atlas-tag-text">{t(`compendium.kind.${option}`)}</span>
                  <span className="atlas-tag-count">{counts.get(option) ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <header className="atlas-asset-manager-header">
        <div className="atlas-am-toolbar atlas-compendium-toolbar">
          <div className="atlas-am-toolbar-left" />
          <div className="atlas-am-toolbar-center">{tabs}</div>
          <div className="atlas-am-toolbar-right">
            <label className="atlas-compendium-search">
              <Search aria-hidden />
              <input
                type="search"
                placeholder={t('compendium.browser.search')}
                aria-label={t('compendium.browser.search')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <LabelTooltip label={t('compendium.browser.newEntry')}>
              <Button
                variant="default"
                size="icon"
                className="atlas-asset-manager-create-btn"
                aria-label={t('compendium.browser.newEntry')}
                disabled={books.length === 0}
                onClick={() => setDialog('entry')}
              >
                <FilePlus />
              </Button>
            </LabelTooltip>
          </div>
        </div>
      </header>

      <div className="atlas-asset-manager-body atlas-compendium-body">
        <div className="atlas-compendium-list" role="listbox" aria-label={t('compendium.browser.tab')}>
          {shown.length === 0 && <p className="atlas-compendium-list__empty">{emptyText}</p>}
          {shown.map((entry) => (
            <div
              key={entry.path}
              role="option"
              tabIndex={0}
              aria-selected={entry.path === selected?.path}
              className="atlas-compendium-list__row"
              onClick={() => setSelectedPath(entry.path)}
              onDoubleClick={() => openEntry(entry)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') openEntry(entry);
                else if (event.key === ' ') { event.preventDefault(); setSelectedPath(entry.path); }
              }}
            >
              <span className="atlas-compendium-list__name">{entry.name}</span>
              <span className="atlas-compendium-list__detail">
                {t(`compendium.kind.${entry.group}`)}
                {bookId === null && books.length > 1 ? ` · ${bookName(entry.bookId)}` : ''}
              </span>
            </div>
          ))}
        </div>
        <CompendiumEntryPreview app={app} entry={selected} onOpen={openEntry} onDelete={(entry) => { void deleteEntry(entry); }} />
      </div>

      <AnimatePresence>
        {dialog === 'sources' && campaign && campaignService && (
          <CompendiumSourcesDialog key="sources" app={app} campaign={campaign} service={campaignService} onClose={() => setDialog(null)} />
        )}
        {dialog === 'entry' && (
          <NewEntryDialog
            key="entry"
            books={books}
            initialBookId={bookId}
            initialKind={group !== null && isEntryKind(group) ? group : null}
            onCreate={createEntry}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'book' && (
          <NewBookDialog
            key="book"
            systems={systems}
            initialSystem={books.find((book) => book.id === bookId)?.systemName ?? books[0]?.systemName ?? null}
            onCreate={createBook}
            onClose={() => setDialog(null)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
