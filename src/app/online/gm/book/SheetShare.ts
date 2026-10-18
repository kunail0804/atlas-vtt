import { isRecord, parsePlayerMessage, type FoundNote, type GmMessage, type SharedSheet } from '../../protocol/index.ts';
import type { SheetEdit } from '../../../characterSheets/sheetNote.ts';
import { AssetAnswers } from '../assetAnswers.ts';
import type { ScaleImage } from '../assetVariants.ts';
import { every, type Timers } from '../companionTimers.ts';
import { MoveRate } from '../moveCheck.ts';
import type { VaultImage } from '../TokenShare.ts';

/** A character's sheet as players are sent it, the notes linked for its player, and what their assets are served from. */
export interface ReadSheet {
  readonly sheet: SharedSheet;
  readonly notes: readonly FoundNote[];
  /** The notes' vault paths, which a change of any of them sends the sheet again. */
  readonly paths: readonly string[];
  /** The notes' whole texts by hash. */
  readonly texts: ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
  /** The notes' images' vault paths by hash. */
  readonly images: ReadonlyMap<string, string>;
}

export interface SheetSharePorts extends Timers {
  send(body: GmMessage, to: string): void;
  /** The players connected now. */
  online(): readonly string[];
  /** The vault path of the statblock note of the character `player` plays now; null for none. */
  noteOf(player: string): string | null;
  /** The sheet a note holds now, with its player's notes; null where the note is no character sheet. */
  read(path: string): Promise<ReadSheet | null>;
  /** Writes a player's edit into the note's sheet by its system's rules; false where it was refused. */
  write(path: string, edit: SheetEdit): Promise<boolean>;
  readImage(path: string): Promise<VaultImage | null>;
  scaleImage?: ScaleImage | undefined;
}

/** How often each player's character is looked at again: a sheet follows a token given or taken within this time. */
export const SHEET_POLL_MS = 500;
/** A player's edits: a burst of typing, then a few a second. */
const SHEET_BURST = 40;
const SHEET_EDITS_PER_SECOND = 8;

interface Sent {
  readonly path: string | null;
  readonly text: string;
  readonly read: ReadSheet | null;
}

/**
 * The character sheets of a running table: each player is sent the sheet of the character they play
 * (its statblock note, where that is a character sheet) and the notes the GM linked to it, again
 * whenever their character, the note or one of those notes changes. A player's edit of their sheet
 * is written into the note at once, by the sheet's own rules; one that is refused is answered with
 * the sheet as the note holds it, so the page shows what is kept. The linked notes' texts and images
 * are served to that player alone.
 */
export class SheetShare {
  private readonly sent = new Map<string, Sent>();
  /** Players whose sheet is being read, and those owed another read once it is done. */
  private readonly reading = new Set<string>();
  private readonly again = new Set<string>();
  private readonly rate = new MoveRate(SHEET_BURST, SHEET_EDITS_PER_SECOND);
  private readonly answers: AssetAnswers;
  private stopPoll: (() => void) | null = null;

  constructor(private readonly ports: SheetSharePorts) {
    const asset = (hash: string, player: string): { text?: Uint8Array<ArrayBuffer>; path?: string } | undefined => {
      const read = this.sent.get(player)?.read;
      const text = read?.texts.get(hash);
      if (text !== undefined) return { text };
      const path = read?.images.get(hash);
      return path === undefined ? undefined : { path };
    };
    this.answers = new AssetAnswers({ send: (body, to) => ports.send(body, to), now: () => ports.now(), readImage: (path) => ports.readImage(path), scaleImage: ports.scaleImage }, {
      map: () => null,
      explored: () => undefined,
      artPath: (hash, player) => asset(hash, player)?.path,
      text: (hash, player) => asset(hash, player)?.text,
    });
  }

  start(): void {
    this.stopPoll ??= every(this.ports, SHEET_POLL_MS, () => this.update());
    this.update();
  }

  stop(): void {
    this.stopPoll?.();
    this.stopPoll = null;
    this.sent.clear();
  }

  /** Sends each connected player whose character is another now their sheet. */
  update(): void {
    const online = new Set(this.ports.online());
    for (const player of [...this.sent.keys()]) if (!online.has(player)) this.sent.delete(player);
    for (const player of online) {
      const path = this.ports.noteOf(player);
      const sent = this.sent.get(player);
      if (sent === undefined || sent.path !== path) void this.refresh(player);
    }
  }

  /** A note changed: every player whose sheet is it, or names it among their notes, is sent their sheet again. */
  noteChanged(path: string): void {
    for (const [player, sent] of this.sent) if (sent.path === path || sent.read?.paths.includes(path) === true) void this.refresh(player);
  }

  /** Everything again, to one player or to all. */
  resend(to?: string): void {
    if (to === undefined) {
      this.sent.clear();
      this.answers.forget();
    } else {
      this.sent.delete(to);
      this.answers.forget(to);
    }
    this.update();
  }

  playerLeft(player: string): void {
    this.sent.delete(player);
    this.answers.forget(player);
  }

  /** A player's message: true when it was the sheets' (an edit, or a request for an asset of their linked notes). */
  receive(from: string, body: unknown): boolean {
    if (!isRecord(body)) return false;
    if (body.t === 'asset-request') return this.answer(from, body);
    if (body.t !== 'sheet-edit' && body.t !== 'sheet-row') return false;
    const message = parsePlayerMessage(body);
    const path = this.sent.get(from)?.path ?? null;
    if (message === null || (message.t !== 'sheet-edit' && message.t !== 'sheet-row') || path === null || !this.rate.take(from, this.ports.now())) {
      void this.refresh(from);
      return true;
    }
    const edit: SheetEdit = message.t === 'sheet-edit' ? { op: 'set', key: message.key, value: message.value } : { op: 'row', key: message.key, index: message.index, row: message.row };
    void this.ports.write(path, edit).then((written) => {
      // A refused edit: the player's page shows what the note keeps. A written one comes back with the note's change.
      if (!written) void this.refresh(from);
    }, () => void this.refresh(from));
    return true;
  }

  private answer(from: string, body: Record<string, unknown>): boolean {
    const request = parsePlayerMessage(body);
    if (request?.t !== 'asset-request') return false;
    const read = this.sent.get(from)?.read;
    if (read == null || (!read.texts.has(request.hash) && !read.images.has(request.hash))) return false;
    this.answers.answer(from, request);
    return true;
  }

  /** Reads a player's sheet and sends it when it is another than what they were sent; one read per player at a time. */
  private async refresh(player: string): Promise<void> {
    if (this.reading.has(player)) {
      this.again.add(player);
      return;
    }
    this.reading.add(player);
    try {
      const path = this.ports.noteOf(player);
      const read = path === null ? null : await this.ports.read(path).catch(() => null);
      if (!this.ports.online().includes(player)) return;
      const body: GmMessage = { t: 'sheet', sheet: read?.sheet ?? null, notes: read?.notes ?? [] };
      const text = JSON.stringify(body);
      const sent = this.sent.get(player);
      this.sent.set(player, { path, text, read });
      if (sent?.text !== text) this.ports.send(body, player);
    } finally {
      this.reading.delete(player);
      if (this.again.delete(player)) void this.refresh(player);
    }
  }
}
