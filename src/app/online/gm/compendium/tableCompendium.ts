import type { App, EventRef, TFile } from 'obsidian';
import type { GmMessage } from '../../protocol/index.ts';
import { cardName } from '../../../compendium/entryCard';
import { editedValue, pageContentOf, withBody } from '../../../compendium/sharedPage';
import { COMPENDIUM_ROOT, ENTRY_KIND_KEY, isEntryKind } from '../../../compendium/sourceFormat';
import { t } from '../../../i18n';
import { PlayerRoster } from '../../../players/PlayerRoster';
import { sharesOf } from '../../../players/roster';
import { noteName } from '../../../utils/pathUtils';
import { companionTimers } from '../companionTimers.ts';
import { CompendiumShare } from './CompendiumShare.ts';
import type { CompendiumBook } from '../../../compendium/compendiumEntries';
import type { PickKind } from '../../../characterSheets/sheetCompendium.ts';
import type { SheetValues } from '../../../characterSheets/sheetFields.ts';
import { SHEET_KEY } from '../../../characterSheets/sheetSystem.ts';

/** What reaches a sheet from the table, loaded once a table starts: it reads campaigns, sources and books. */
const sheetModules = async () => {
  const [picks, pick, host, play, service] = await Promise.all([
    import('../../../compendium/sheetPicks'),
    import('../../../characterSheets/obsidian/sheetPick.ts'),
    import('../../../characterSheets/obsidian/sheetCompendiumHost.ts'),
    import('../../../campaigns/campaignPlay'),
    import('../../../compendium/CompendiumService'),
  ]);
  return { ...picks, ...pick, ...host, CampaignPlay: play.CampaignPlay, CompendiumService: service.CompendiumService };
};
type SheetModules = Awaited<ReturnType<typeof sheetModules>>;

export interface TableCompendium {
  readonly share: CompendiumShare;
  start(): void;
  stop(): void;
}

/**
 * The compendium pages of a running table in Obsidian: the vault's players and their shares
 * (`PlayerRoster`), each note read from the vault and a player's change written into it.
 */
export function tableCompendium(app: App, send: (body: GmMessage, to: string) => void, nameOf: (player: string) => string | null, statblockOf: (player: string) => string | null = () => null): TableCompendium {
  const roster = PlayerRoster.forApp(app);
  const timers = companionTimers();
  /** The campaign's books as a sheet reads them, read again when sources or the campaign played change. */
  let books: readonly CompendiumBook[] = [];
  let modules: SheetModules | null = null;
  const loaded = (): Promise<SheetModules> => sheetModules().then((read) => (modules = read));
  const readBooks = (): void => void loaded().then((read) => read.sheetBooks(app)).then((read) => { books = read; share.sharesChanged(); }, () => undefined);
  const sheetOf = (player: string): string | null => {
    const path = statblockOf(player);
    const file = path === null ? null : app.vault.getFileByPath(path);
    return path !== null && file !== null && app.metadataCache.getFileCache(file)?.frontmatter?.[SHEET_KEY] !== undefined ? path : null;
  };
  const sheetValues = (path: string): Readonly<Record<string, unknown>> => {
    const file = app.vault.getFileByPath(path);
    return (file === null ? undefined : app.metadataCache.getFileCache(file)?.frontmatter) ?? {};
  };
  const share = new CompendiumShare({
    sheetOf,
    sheetChoices: async (kind, sheet) => {
      const read = await loaded();
      return (await read.sheetChoices(app, kind, read.classNamesOf(sheetValues(sheet) as SheetValues))).map(({ id, name, detail }) => ({ path: id, name, ...(detail !== undefined && { detail }) }));
    },
    pick: async (sheet, kind, entry) => (await (await loaded()).applySheetPick(app, sheet, kind, entry)).sheet,
    findEntry: async (kind, name) => (await (await loaded()).findSheetEntry(app, kind, name))?.path ?? null,
    sheetLinks: (sheet) => {
      const values = sheetValues(sheet);
      const names = (key: string): string[] => (Array.isArray(values[key]) ? (values[key] as unknown[]).map((row) => {
        const name = typeof row === 'object' && row !== null ? (row as Record<string, unknown>).name : undefined;
        return typeof name === 'string' ? name : '';
      }).filter((name) => name !== '') : []);
      const lookup = (kind: PickKind, wanted: readonly string[]): string[] => {
        if (wanted.length === 0 || modules === null) return [];
        const { entriesOfKind } = modules;
        const set = new Set(wanted.map((name) => name.toLowerCase()));
        return entriesOfKind(app, books, kind).filter((entry) => set.has(entry.name.toLowerCase())).map((entry) => entry.path);
      };
      return [...lookup('spell', names('spell-list')), ...lookup('weapon', names('attacks'))];
    },
    send,
    nameOf,
    identify: (key, name) => roster.identify(key, name),
    sharesOf: (playerId) => sharesOf(roster.current(), playerId),
    describe: (path) => {
      const file = app.vault.getFileByPath(path);
      if (file === null) return null;
      const frontmatter: Readonly<Record<string, unknown>> = app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const kind = frontmatter[ENTRY_KIND_KEY];
      // `Compendium/<system>/<book>/…`: the folders name the book and its system.
      const [root, system, book] = path.split('/');
      const inBook = root === COMPENDIUM_ROOT && path.split('/').length > 3 && system !== undefined && book !== undefined;
      return { title: cardName(frontmatter, noteName(path)), kind: isEntryKind(kind) ? kind : 'other', ...(inBook && { source: book, system }) };
    },
    read: async (path) => {
      const file = app.vault.getFileByPath(path);
      if (file === null) return null;
      const { title, kind, rows, sections, text, fields } = pageContentOf(await app.vault.cachedRead(file), noteName(path), t('compendium.browser.yes'));
      return { title, kind, content: { rows, sections, text }, fields };
    },
    write: async (path, edit, allowed) => {
      const file = app.vault.getFileByPath(path);
      if (file === null) return false;
      await app.vault.process(file, (data) => withBody(data, edit.text));
      const keys = Object.keys(edit.fields).filter((key) => allowed.includes(key));
      if (keys.length === 0) return true;
      await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        for (const key of keys) {
          const written = edit.fields[key] ?? '';
          const value = editedValue(frontmatter[key], written);
          // Left as it was when unchanged, so the note's YAML keeps its own writing.
          if (value !== null && String(frontmatter[key]) !== written && !(Array.isArray(value) && JSON.stringify(value) === JSON.stringify(frontmatter[key]))) frontmatter[key] = value;
        }
      });
      return true;
    },
    now: () => timers.now(),
  });
  let stops: Array<() => void> = [];
  return {
    share,
    start: () => {
      if (stops.length > 0) return;
      void roster.load();
      readBooks();
      // Sources and the campaign played: the books follow, once the modules are here.
      void loaded().then((read) => {
        if (stops.length === 0) return;
        stops.push(read.CompendiumService.forApp(app).onChange(readBooks), read.CampaignPlay.forApp(app).onChange(readBooks));
      }, () => undefined);
      // A renamed note keeps its shares through the roster, whose change sends every list again.
      const changed: EventRef = app.metadataCache.on('changed', (file: TFile) => share.noteChanged(file.path));
      stops = [
        roster.onChange(() => share.sharesChanged()),
        () => app.metadataCache.offref(changed),
        () => share.stop(),
      ];
    },
    stop: () => {
      for (const stop of stops) stop();
      stops = [];
    },
  };
}
