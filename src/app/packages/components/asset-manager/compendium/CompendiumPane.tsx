import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { TFile, type App } from 'obsidian';
import { AnimatePresence } from 'framer-motion';
import { BookPlus, Copy, FilePlus, Library, Pencil, X, Search, Settings, Share2, Trash2, Upload, UserPlus, Users } from 'lucide-react';
import { CampaignFiles } from '../../../../campaigns/CampaignFiles';
import { CampaignPlay } from '../../../../campaigns/campaignPlay';
import { useCampaigns } from '../../../../campaigns/useCampaigns';
import { CompendiumService } from '../../../../compendium/CompendiumService';
import { exportCompendiumBook } from '../../../../compendium/compendiumFileMenu';
import { booksOf, entryMatches, groupCounts, type CompendiumBook, type CompendiumEntry, type EntryGroup } from '../../../../compendium/compendiumEntries';
import { OFFICIAL_SOURCES } from '../../../../compendium/officialSources';
import { PERSONAL_BOOK_ID, isPersonalBookId } from '../../../../compendium/sourceTree';
import { ENTRY_KINDS, isEntryKind, type EntryKind } from '../../../../compendium/sourceFormat';
import { CompendiumSourcesDialog } from '../../../../react/components/dashboard/compendium/CompendiumSourcesDialog';
import { useInstalledSources } from '../../../../react/components/dashboard/compendium/useInstalledSources';
import { useSourceInstalls } from '../../../../react/components/dashboard/compendium/useSourceInstalls';
import { confirmAction } from '../../../../ui/confirmDialog';
import { showNotice } from '../../../../ui/notice';
import { Button } from '../../primitives/button';
import { LabelTooltip } from '../../primitives/tooltip';
import { t } from '../../../../i18n';
import { CompendiumEntryPreview } from './CompendiumEntryPreview';
import { NewBookDialog } from './NewBookDialog';
import { NewEntryDialog } from './NewEntryDialog';
import { CopyDialog } from './CopyDialog';
import { PlayerDialog } from './PlayerDialog';
import { ShareDialog } from './ShareDialog';
import { useRoster } from '../../../../players/useRoster';
import type { ShareAccess } from '../../../../players/roster';
import { useCompendiumEntries } from './useCompendiumEntries';

/** The value of the campaign list that shows every installed source, whatever campaign uses it. */
const WHOLE_VAULT = '';
const GROUPS: readonly EntryGroup[] = [...ENTRY_KINDS, 'other'];

type OpenDialog = 'sources' | 'entry' | 'book' | 'share' | 'player' | 'copy' | null;

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
  const missing = campaign && installed
    ? (campaignSources ?? []).filter((id) => !installed.some((source) => source.manifest.id === id))
    : [];
  const installs = useSourceInstalls(app);
  const entries = useCompendiumEntries(app, books);

  // A campaign that uses books of a system has that system's Personal book, made on the fly.
  const ensured = useRef(new Set<string>());
  useEffect(() => {
    if (!campaign || !campaignService || campaign.readOnly === true || installed === undefined) return;
    const listed = campaign.sources ?? [];
    const systems = new Map<string, { id: string; name: string }>();
    for (const source of installed) {
      if (listed.includes(source.manifest.id) && !isPersonalBookId(source.manifest.id)) systems.set(source.manifest.system.id, source.manifest.system);
    }
    const lacking = [...systems.values()].filter((system) => !listed.includes(`${system.id}/${PERSONAL_BOOK_ID}`) && !ensured.current.has(`${campaign.id}:${system.id}`));
    if (lacking.length === 0) return;
    for (const system of lacking) ensured.current.add(`${campaign.id}:${system.id}`);
    void (async () => {
      const made: string[] = [];
      for (const system of lacking) {
        try {
          made.push(await CompendiumService.forApp(app).ensurePersonalBook(system, { id: PERSONAL_BOOK_ID, name: t('compendium.personalBook') }));
        } catch (error) {
          console.error('[CompendiumPane] Making a Personal book failed:', error);
        }
      }
      const current = campaignService.get(campaign.id)?.sources ?? [];
      const added = made.filter((id) => !current.includes(id));
      if (added.length > 0) campaignService.update(campaign.id, { sources: [...current, ...added] });
    })();
  }, [app, campaign, campaignService, installed]);

  const [group, setGroup] = useState<EntryGroup | null>(null);
  const [chosenBookId, setChosenBookId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const { roster, service: players } = useRoster(app);
  /** The entries ticked for a batch share, by path. */
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  /** The player whose pages the list shows; null for every entry. */
  const [chosenPlayer, setChosenPlayer] = useState<string | null>(null);
  /** The player the player dialog changes; null makes a new one. */
  const [editedPlayer, setEditedPlayer] = useState<string | null>(null);
  /** The pages the share dialog shares. */
  const [sharing, setSharing] = useState<readonly string[]>([]);
  /** Counts the dialogs opened: each opening is a dialog of its own, never one still closing. */
  const [opening, setOpening] = useState(0);
  const dialogOpen = dialog !== null;
  useEffect(() => {
    onDialogChange(dialogOpen);
    return () => onDialogChange(false);
  }, [dialogOpen, onDialogChange]);

  const bookId = books.some((book) => book.id === chosenBookId) ? chosenBookId : null;
  const filter = { group, bookId, search };
  const playerFilter = chosenPlayer !== null && chosenPlayer in roster.players ? chosenPlayer : null;
  const shown = entries.filter((entry) => entryMatches(entry, filter) && (playerFilter === null || roster.shares[entry.path]?.[playerFilter] !== undefined));
  const ticked = shown.filter((entry) => checked.has(entry.path));
  const playerList = Object.entries(roster.players).sort((a, b) => a[1].name.localeCompare(b[1].name));
  const sharedCount = (id: string): number => entries.filter((entry) => roster.shares[entry.path]?.[id] !== undefined).length;
  /** "Alice (read), Bob (read and write)", for the note at `path`. */
  const sharedWith = (path: string): string => {
    const names = Object.entries(roster.shares[path] ?? {})
      .map(([id, access]) => ({ name: roster.players[id]?.name ?? id, access }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, access }) => t(access === 'write' ? 'compendium.share.writeBy' : 'compendium.share.readBy', { name }));
    return names.length === 0 ? t('compendium.share.notShared') : t('compendium.share.sharedWith', { names: names.join(', ') });
  };
  const toggleChecked = (path: string): void => {
    const next = new Set(checked);
    if (!next.delete(path)) next.add(path);
    setChecked(next);
  };
  const openShare = (paths: readonly string[]): void => {
    if (paths.length === 0) return;
    setSharing(paths);
    setOpening((count) => count + 1);
    setDialog('share');
  };
  const openPlayer = (id: string | null): void => {
    setEditedPlayer(id);
    setOpening((count) => count + 1);
    setDialog('player');
  };
  /** Moves every ticked entry to the trash, once the GM confirms. */
  const deleteTicked = async (): Promise<void> => {
    const doomed = [...ticked];
    if (doomed.length === 0) return;
    const confirmed = await confirmAction({
      title: t('compendium.batch.deleteTitle', { count: doomed.length }),
      message: [t('compendium.batch.deleteMessage')],
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    const failed: string[] = [];
    for (const entry of doomed) {
      const file = app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) continue;
      try {
        await app.fileManager.trashFile(file);
      } catch (error) {
        console.error('[CompendiumPane] Deleting a note failed:', error);
        failed.push(entry.name);
      }
    }
    setChecked(new Set());
    if (selected !== null && doomed.some((entry) => entry.path === selected.path)) setSelectedPath(null);
    if (failed.length > 0) showNotice(t('compendium.batch.deleteFailed', { names: failed.join(', ') }));
  };

  /** The books entries can be copied into: those of the GM's own. */
  const ownBooks = books.filter((book) => !OFFICIAL_SOURCES.some((source) => source.id === book.id));

  const removePlayer = async (id: string): Promise<void> => {
    const name = roster.players[id]?.name ?? id;
    const confirmed = await confirmAction({
      title: t('compendium.player.removeTitle', { name }),
      message: [t('compendium.player.removeMessage')],
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!confirmed) return;
    if (chosenPlayer === id) setChosenPlayer(null);
    await players.remove(id);
  };
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
    setChosenBookId(id);
    // A campaign shows only the books it uses: the new book joins it, once.
    const listed = campaign?.sources ?? [];
    if (!campaign || !campaignService || campaign.readOnly === true || listed.includes(id)) return;
    try {
      campaignService.update(campaign.id, { sources: [...listed, id] });
    } catch (error) {
      // The book exists either way: the GM can still tick it in the source picker.
      console.error('[CompendiumPane] Adding the book to the campaign failed:', error);
      showNotice(t('compendium.browser.bookNotAdded', { name: bookName, error: messageOf(error) }));
    }
  };

  /** Removes a book from the vault, after the GM says so; the campaign shown stops listing it. */
  const removeBook = async (book: CompendiumBook): Promise<void> => {
    if (!(await installs.remove(book.id, book.name))) return;
    if (chosenBookId === book.id) setChosenBookId(null);
    setSelectedPath(null);
    const listed = campaign?.sources ?? [];
    if (!campaign || !campaignService || campaign.readOnly === true || !listed.includes(book.id)) return;
    try {
      campaignService.update(campaign.id, { sources: listed.filter((id) => id !== book.id) });
    } catch (error) {
      console.error('[CompendiumPane] Taking the book off the campaign failed:', error);
    }
  };

  /** A source the campaign lists but the vault lacks, by name where Atlas knows it. */
  const missingName = (id: string): string => {
    const official = OFFICIAL_SOURCES.find((source) => source.id === id);
    return official ? `${official.system.name} · ${official.book.name}` : id;
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
                // A system's Personal book is Atlas' to keep: never removed or exported from here.
                const own = isPersonalBookId(book.id);
                const personal = !own && !OFFICIAL_SOURCES.some((source) => source.id === book.id);
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
                    {!own && <LabelTooltip label={t('compendium.remove', { name: book.name })}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="atlas-collection-header-btn"
                        aria-label={t('compendium.remove', { name: book.name })}
                        disabled={installs.busy !== null}
                        onClick={() => { void removeBook(book); }}
                      >
                        <Trash2 />
                      </Button>
                    </LabelTooltip>}
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
            <div className="atlas-compendium-sidebar__heading">
              <div className="atlas-section-title">{t('compendium.player.heading')}</div>
              <LabelTooltip label={t('compendium.player.new')}>
                <Button variant="ghost" size="icon" className="atlas-collection-header-btn" aria-label={t('compendium.player.new')} onClick={() => openPlayer(null)}>
                  <UserPlus />
                </Button>
              </LabelTooltip>
            </div>
            <div className="atlas-compendium-sidebar__list">
              {playerList.length > 0 && (
                <button type="button" className={`atlas-tag-button ${playerFilter === null ? 'atlas-active' : ''}`} aria-pressed={playerFilter === null} onClick={() => setChosenPlayer(null)}>
                  <Users className="atlas-tag-icon" />
                  <span className="atlas-tag-text">{t('compendium.player.all')}</span>
                </button>
              )}
              {playerList.length === 0 && <p className="atlas-compendium-sidebar__hint">{t('compendium.share.noPlayers')}</p>}
              {playerList.map(([id, player]) => (
                <div key={id} className="atlas-compendium-sidebar__book">
                  <LabelTooltip label={t('compendium.player.filter', { name: player.name })} describe>
                    <button type="button" className={`atlas-tag-button ${playerFilter === id ? 'atlas-active' : ''}`} aria-pressed={playerFilter === id} onClick={() => setChosenPlayer(id)}>
                      <span className="atlas-tag-text">{player.name}</span>
                      <span className="atlas-tag-count">{sharedCount(id)}</span>
                    </button>
                  </LabelTooltip>
                  <LabelTooltip label={t('compendium.player.edit', { name: player.name })}>
                    <Button variant="ghost" size="icon" className="atlas-collection-header-btn" aria-label={t('compendium.player.edit', { name: player.name })} onClick={() => openPlayer(id)}>
                      <Pencil />
                    </Button>
                  </LabelTooltip>
                  <LabelTooltip label={t('compendium.player.remove', { name: player.name })}>
                    <Button variant="ghost" size="icon" className="atlas-collection-header-btn" aria-label={t('compendium.player.remove', { name: player.name })} onClick={() => { void removePlayer(id); }}>
                      <Trash2 />
                    </Button>
                  </LabelTooltip>
                </div>
              ))}
            </div>
          </div>

          {missing.length > 0 && (
            <section className="atlas-compendium-sidebar__section" aria-label={t('compendium.missing')}>
              <div className="atlas-section-title">{t('compendium.missing')}</div>
              <p className="atlas-compendium-sidebar__hint">{t('compendium.browser.missingHint')}</p>
              <ul className="atlas-compendium-sidebar__missing">
                {missing.map((id) => <li key={id}>{missingName(id)}</li>)}
              </ul>
            </section>
          )}

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
            <LabelTooltip label={ticked.length > 0 ? t('compendium.share.buttonMany', { count: ticked.length }) : t('compendium.share.button')}>
              <Button
                variant="ghost"
                size="icon"
                className="atlas-collection-header-btn"
                aria-label={ticked.length > 0 ? t('compendium.share.buttonMany', { count: ticked.length }) : t('compendium.share.button')}
                disabled={ticked.length === 0 && selected === null}
                onClick={() => openShare(ticked.length > 0 ? ticked.map((entry) => entry.path) : selected ? [selected.path] : [])}
              >
                <Share2 />
              </Button>
            </LabelTooltip>
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
          {ticked.length > 0 && (
            <div className="atlas-compendium-list__batch" role="toolbar" aria-label={t('compendium.share.selected', { count: ticked.length })}>
              <span className="atlas-compendium-list__batch-count">{t('compendium.share.selected', { count: ticked.length })}</span>
              <LabelTooltip label={t('compendium.share.buttonMany', { count: ticked.length })}>
                <Button variant="ghost" size="icon" className="atlas-collection-header-btn" aria-label={t('compendium.share.buttonMany', { count: ticked.length })} onClick={() => openShare(ticked.map((entry) => entry.path))}>
                  <Share2 />
                </Button>
              </LabelTooltip>
              <LabelTooltip label={t('compendium.batch.copy', { count: ticked.length })}>
                <Button variant="ghost" size="icon" className="atlas-collection-header-btn" aria-label={t('compendium.batch.copy', { count: ticked.length })} onClick={() => { setOpening((count) => count + 1); setDialog('copy'); }}>
                  <Copy />
                </Button>
              </LabelTooltip>
              <LabelTooltip label={t('compendium.batch.delete', { count: ticked.length })}>
                <Button variant="ghost" size="icon" className="atlas-collection-header-btn" aria-label={t('compendium.batch.delete', { count: ticked.length })} onClick={() => { void deleteTicked(); }}>
                  <Trash2 />
                </Button>
              </LabelTooltip>
              <LabelTooltip label={t('compendium.share.clear')}>
                <Button variant="ghost" size="icon" className="atlas-collection-header-btn" aria-label={t('compendium.share.clear')} onClick={() => setChecked(new Set())}>
                  <X />
                </Button>
              </LabelTooltip>
            </div>
          )}
          {shown.length > 0 && (
            <label className="atlas-compendium-list__select-all">
              <input
                type="checkbox"
                aria-label={ticked.length === shown.length ? t('compendium.share.clear') : t('compendium.share.selectAll')}
                checked={ticked.length === shown.length}
                ref={(box) => { if (box) box.indeterminate = ticked.length > 0 && ticked.length < shown.length; }}
                onChange={() => setChecked(ticked.length === shown.length ? new Set() : new Set(shown.map((entry) => entry.path)))}
              />
              <span>{ticked.length > 0 ? t('compendium.share.selected', { count: ticked.length }) : t('compendium.share.selectAll')}</span>
            </label>
          )}
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
              <input
                type="checkbox"
                className="atlas-compendium-list__check"
                aria-label={t('compendium.share.select', { name: entry.name })}
                checked={checked.has(entry.path)}
                onClick={(event) => event.stopPropagation()}
                onDoubleClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
                onChange={() => toggleChecked(entry.path)}
              />
              <span className="atlas-compendium-list__name">{entry.name}</span>
              {roster.shares[entry.path] !== undefined && (
                <LabelTooltip label={sharedWith(entry.path)} describe>
                  <Users className="atlas-compendium-list__shared" aria-label={t('compendium.share.shared')} />
                </LabelTooltip>
              )}
              <span className="atlas-compendium-list__detail">
                {t(`compendium.kind.${entry.group}`)}
                {bookId === null && books.length > 1 ? ` · ${bookName(entry.bookId)}` : ''}
              </span>
            </div>
          ))}
        </div>
        <CompendiumEntryPreview
          app={app}
          entry={selected}
          sharedWith={selected ? sharedWith(selected.path) : null}
          onShare={(entry) => openShare([entry.path])}
          onOpen={openEntry}
          onDelete={(entry) => { void deleteEntry(entry); }}
        />
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
        {dialog === 'share' && (
          <ShareDialog
            key={`share-${opening}`}
            roster={roster}
            paths={sharing}
            name={sharing.length === 1 ? entries.find((entry) => entry.path === sharing[0])?.name ?? null : null}
            onSave={(changes: Readonly<Record<string, ShareAccess | null>>) => players.share(sharing, changes)}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'copy' && (
          <CopyDialog
            key={`copy-${opening}`}
            books={ownBooks}
            count={ticked.length}
            onCopy={async (book) => {
              const copies = await CompendiumService.forApp(app).copyEntries(ticked.map((entry) => entry.path), book);
              setChecked(new Set());
              setChosenBookId(book.id);
              setSelectedPath(copies[0]?.path ?? null);
            }}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === 'player' && (
          <PlayerDialog
            key={`player-${opening}`}
            roster={roster}
            playerId={editedPlayer}
            onCreate={async (name) => { await players.add(name); }}
            onRename={(id, name) => players.rename(id, name)}
            onMerge={async (id, into) => {
              await players.merge(id, into);
              if (chosenPlayer === id) setChosenPlayer(into);
            }}
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
