import { normalizePath, type App, type EventRef } from 'obsidian';
import type { GmMessage } from '../../protocol/index.ts';
import { setLootRecipientSource } from '../../../loot/lootRecipients';
import { scaleInWindow } from '../assetVariants.ts';
import { companionTimers } from '../companionTimers.ts';
import type { Ownership } from '../ownership.ts';
import type { VaultImage } from '../TokenShare.ts';
import type { BookScene } from './bookScene.ts';
import { BookShare } from './BookShare.ts';
import { SheetShare } from './SheetShare.ts';
import { sheetSource } from './sheetSource.ts';
import { writeCharacterValue } from './characterValues.ts';
import type { ResourceWrites } from './resourceWrites.ts';
import { gatedQuestAsset, gatedQuests, onQuestsChange } from './questGate.ts';
import { gatedWorldMap, onWorldMapChange } from './worldMapGate.ts';
import type { BookShelf } from './BookShelf.ts';

export interface TableBookPorts {
  readonly app: App;
  /** The books kept on this device. */
  readonly shelf: BookShelf;
  readonly ownership: Ownership;
  send(body: GmMessage, to: string): void;
  /** The shared scene as the books read it, or null while none is shown. */
  scene(): BookScene | null;
  readImage(path: string): Promise<VaultImage | null>;
  randomId(): string;
  /** Where players' edits of their tokens in the shared scene are written; null while no scene is shared. */
  tokenWrites(): ResourceWrites | null;
}

const offref = (app: App, ref: EventRef): (() => void) => () => app.metadataCache.offref(ref);

/** A running table's books, and what they hang on while it runs. */
export interface TableBook {
  readonly share: BookShare;
  /** The players' character sheets and the notes linked to them. */
  readonly sheets: SheetShare;
  start(): void;
  stop(): void;
}

/**
 * The books of a running table in Obsidian: read from the vault and the table's ownership, told at
 * once when tokens change hands or the world map or the quests may be others, and named to the
 * loot roller as the people an item can be handed to for as long as the table runs. A player's edit
 * of a resource goes to their token in the shared scene, else to the values the played campaign
 * keeps of their character.
 */
export function tableBook(ports: TableBookPorts): TableBook {
  const { app, ownership } = ports;
  const timers = companionTimers();
  const share = new BookShare({
    send: (body, to) => ports.send(body, to),
    now: () => timers.now(),
    setTimer: (run, ms) => timers.setTimer(run, ms),
    clearTimer: (timer) => timers.clearTimer(timer),
    clock: () => Date.now(),
    randomId: () => ports.randomId(),
    scene: () => ports.scene(),
    players: () => ownership.list(),
    ownerOf: (tokenId) => ownership.ownerOf(tokenId),
    readImage: (path) => ports.readImage(path),
    stat: (path) => {
      const file = app.vault.getFileByPath(normalizePath(path));
      return file === null ? null : { mtime: file.stat.mtime, size: file.stat.size };
    },
    worldMap: () => gatedWorldMap(),
    quests: () => gatedQuests(),
    questAsset: (hash) => gatedQuestAsset(hash),
    editResource: (edit, answer) => {
      if (edit.kind === 'character') return answer(writeCharacterValue(app, edit));
      const writes = ports.tokenWrites();
      if (writes === null) answer(null);
      else writes.write(edit, answer);
    },
    scaleImage: scaleInWindow,
  }, ports.shelf);
  const source = sheetSource(app);
  const sheets = new SheetShare({
    send: (body, to) => ports.send(body, to),
    now: () => timers.now(),
    setTimer: (run, ms) => timers.setTimer(run, ms),
    clearTimer: (timer) => timers.clearTimer(timer),
    online: () => ownership.list().filter((player) => player.online).map((player) => player.id),
    noteOf: (player) => share.statblockOf(player),
    read: (path) => source.read(path),
    write: (path, edit) => source.write(path, edit),
    readImage: (path) => ports.readImage(path),
    scaleImage: scaleInWindow,
  });
  let stops: (() => void)[] = [];
  return {
    share,
    sheets,
    start: () => {
      if (stops.length > 0) return;
      stops = [
        ownership.onChange(() => share.update()),
        onWorldMapChange(() => share.worldMapChanged()),
        onQuestsChange(() => share.questsChanged()),
        () => setLootRecipientSource(null),
        () => share.stop(),
        () => sheets.stop(),
        // A sheet's note or a note linked to it changed: whoever is sent it gets it again.
        offref(app, app.metadataCache.on('changed', (file) => sheets.noteChanged(file.path))),
      ];
      share.start();
      sheets.start();
      setLootRecipientSource(share);
    },
    stop: () => {
      for (const stop of stops) stop();
      stops = [];
    },
  };
}
