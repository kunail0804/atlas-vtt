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

export interface TableCompendium {
  readonly share: CompendiumShare;
  start(): void;
  stop(): void;
}

/**
 * The compendium pages of a running table in Obsidian: the vault's players and their shares
 * (`PlayerRoster`), each note read from the vault and a player's change written into it.
 */
export function tableCompendium(app: App, send: (body: GmMessage, to: string) => void, nameOf: (player: string) => string | null): TableCompendium {
  const roster = PlayerRoster.forApp(app);
  const timers = companionTimers();
  const share = new CompendiumShare({
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
