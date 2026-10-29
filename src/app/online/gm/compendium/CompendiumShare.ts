import {
  isRecord, parsePageEdit, parsePlayerMessage, type CompendiumAccess, type GmMessage, type PageEdit, type SharedPage, type SharedPageContent,
} from '../../protocol/index.ts';
import { hashText } from '../../../utils/hashing';
import { MoveRate } from '../moveCheck.ts';

/** A page shared with a player: the note's vault path and what the player may do with it. */
export interface PlayerShare {
  readonly path: string;
  readonly access: CompendiumAccess;
}

/** What a page shows of a note, as `CompendiumShare` sends it. */
export interface PageRead {
  readonly title: string;
  readonly kind: string;
  readonly content: Omit<SharedPageContent, keyof SharedPage | 'fields'>;
  /** The properties a player allowed to change the page may change. */
  readonly fields: NonNullable<SharedPageContent['fields']>;
}

export interface CompendiumSharePorts {
  send(body: GmMessage, to: string): void;
  /** The name a player joined the table under. */
  nameOf(player: string): string | null;
  /** The vault's player a device key belongs to (a new one for a device never seen); null for a key refused. */
  identify(key: string, name: string): Promise<string | null>;
  /** The pages shared with one of the vault's players now. */
  sharesOf(playerId: string): readonly PlayerShare[];
  /** The title, kind and book of a note, from what the vault knows of it now; null for a note that is gone. */
  describe(path: string): { title: string; kind: string; source?: string; system?: string } | null;
  read(path: string): Promise<PageRead | null>;
  /** Writes a player's change into the note: only the properties of `allowed`. False where it failed. */
  write(path: string, edit: PageEdit, allowed: readonly string[]): Promise<boolean>;
  now(): number;
}

/** A page's id for the player: never the note's path, and the same for the same note. */
export const pageIdOf = (path: string): string => hashText(path).slice(0, 16);

interface Assembly {
  readonly id: string;
  readonly edit: string;
  readonly parts: (string | undefined)[];
}

/** A player's reads and changes: a burst, then a few a second. */
const PAGE_BURST = 20;
const PAGES_PER_SECOND = 4;

/**
 * The compendium pages the GM shares, for a running table. A player says who they are with their
 * device key (`identify`, after every welcome): from then on they are sent the list of the pages
 * shared with that player of the vault, again whenever it changes, and a page whole when they open
 * it, again when its note changes. A change a player may make arrives in parts and is written into
 * the note once whole; their access is looked at again then, never taken from when they opened it.
 */
export class CompendiumShare {
  /** The vault's player each player at the table is, by relay id. */
  private readonly seats = new Map<string, string>();
  /** The pages each was last sent in their list, by page id. */
  private readonly listed = new Map<string, Map<string, PlayerShare>>();
  private readonly sentLists = new Map<string, string>();
  private readonly opened = new Map<string, Set<string>>();
  private readonly assemblies = new Map<string, Assembly>();
  private readonly rate = new MoveRate(PAGE_BURST, PAGES_PER_SECOND);

  constructor(private readonly ports: CompendiumSharePorts) {}

  /** A player's message: true when it was the compendium's. */
  receive(from: string, body: unknown): boolean {
    if (!isRecord(body) || (body.t !== 'identify' && body.t !== 'compendium-open' && body.t !== 'compendium-edit')) return false;
    const message = parsePlayerMessage(body);
    if (message?.t === 'identify') void this.identify(from, message.key);
    else if (message?.t === 'compendium-open') this.open(from, message.id);
    else if (message?.t === 'compendium-edit') this.part(from, message.id, message.edit, message.index, message.count, message.data);
    return true;
  }

  /** The vault's players or their shares changed: every list and open page follows. */
  sharesChanged(): void {
    for (const player of this.seats.keys()) this.update(player);
  }

  /** A note changed: whoever has it in their list is sent the list, and the page if they opened it. */
  noteChanged(path: string): void {
    const id = pageIdOf(path);
    for (const [player, pages] of this.listed) {
      if (!pages.has(id)) continue;
      this.sendList(player);
      if (this.opened.get(player)?.has(id) === true) void this.sendPage(player, id);
    }
  }

  playerLeft(player: string): void {
    this.seats.delete(player);
    this.listed.delete(player);
    this.sentLists.delete(player);
    this.opened.delete(player);
    this.assemblies.delete(player);
  }

  stop(): void {
    for (const player of [...this.seats.keys()]) this.playerLeft(player);
  }

  /** The vault's player a player at the table is, once they said; undefined before. */
  playerOf(player: string): string | undefined {
    return this.seats.get(player);
  }

  private async identify(from: string, key: string): Promise<void> {
    const id = await this.ports.identify(key, this.ports.nameOf(from) ?? '').catch((error: unknown) => {
      console.error('[CompendiumShare] Telling who a player is failed:', error);
      return null;
    });
    if (id === null) return;
    if (this.seats.get(from) !== id) {
      this.listed.delete(from);
      this.sentLists.delete(from);
      this.opened.delete(from);
    }
    this.seats.set(from, id);
    this.update(from);
  }

  /** The player's list as it is now, and their open pages again where their access changed or they lost one. */
  private update(player: string): void {
    const before = this.listed.get(player);
    this.sendList(player);
    const after = this.listed.get(player);
    const opened = this.opened.get(player);
    if (!opened) return;
    for (const id of [...opened]) {
      const share = after?.get(id);
      if (share === undefined) opened.delete(id);
      else if (before?.get(id)?.access !== share.access) void this.sendPage(player, id);
    }
  }

  private sendList(player: string): void {
    const playerId = this.seats.get(player);
    if (playerId === undefined) return;
    const pages = new Map<string, PlayerShare>();
    const list: SharedPage[] = [];
    for (const share of this.ports.sharesOf(playerId)) {
      const described = this.ports.describe(share.path);
      if (described === null) continue;
      const id = pageIdOf(share.path);
      pages.set(id, share);
      list.push({
        id, title: described.title, kind: described.kind, access: share.access,
        ...(described.source !== undefined && { source: described.source }), ...(described.system !== undefined && { system: described.system }),
      });
    }
    list.sort((a, b) => a.title.localeCompare(b.title));
    this.listed.set(player, pages);
    const body: GmMessage = { t: 'compendium', pages: list };
    const text = JSON.stringify(body);
    if (this.sentLists.get(player) === text) return;
    this.sentLists.set(player, text);
    this.ports.send(body, player);
  }

  private open(from: string, id: string): void {
    if (!this.listed.get(from)?.has(id) || !this.rate.take(from, this.ports.now())) return;
    const opened = this.opened.get(from) ?? new Set<string>();
    opened.add(id);
    this.opened.set(from, opened);
    void this.sendPage(from, id);
  }

  private async sendPage(player: string, id: string): Promise<void> {
    const share = this.listed.get(player)?.get(id);
    if (share === undefined) return;
    const read = await this.ports.read(share.path).catch(() => null);
    // Still theirs once read, with the access they have now.
    const now = this.listed.get(player)?.get(id);
    if (read === null || now === undefined) return;
    const described = this.ports.describe(share.path);
    const page: SharedPageContent = {
      id, title: read.title, kind: read.kind, access: now.access, ...read.content,
      ...(described?.source !== undefined && { source: described.source }), ...(described?.system !== undefined && { system: described.system }),
      ...(now.access === 'write' && { fields: read.fields }),
    };
    this.ports.send({ t: 'compendium-entry', page }, player);
  }

  private part(from: string, id: string, edit: string, index: number, count: number, data: string): void {
    let assembly = this.assemblies.get(from);
    if (assembly?.id !== id || assembly.edit !== edit || assembly.parts.length !== count) {
      // A new change: one at a time per player, the last one started wins.
      assembly = { id, edit, parts: new Array<string | undefined>(count).fill(undefined) };
      this.assemblies.set(from, assembly);
    }
    assembly.parts[index] = data;
    if (assembly.parts.some((part) => part === undefined)) return;
    this.assemblies.delete(from);
    void this.save(from, id, assembly.parts.join(''));
  }

  private async save(from: string, id: string, text: string): Promise<void> {
    const share = this.listed.get(from)?.get(id);
    const edit = parsePageEdit(text);
    const refuse = (): void => {
      this.ports.send({ t: 'compendium-saved', id, ok: false }, from);
      void this.sendPage(from, id);
    };
    if (share?.access !== 'write' || edit === null || !this.rate.take(from, this.ports.now())) return refuse();
    const read = await this.ports.read(share.path).catch(() => null);
    if (read === null || this.listed.get(from)?.get(id)?.access !== 'write') return refuse();
    const written = await this.ports.write(share.path, edit, read.fields.map((field) => field.key)).catch((error: unknown) => {
      console.error('[CompendiumShare] Writing a player\'s change failed:', error);
      return false;
    });
    if (!written) return refuse();
    this.ports.send({ t: 'compendium-saved', id, ok: true }, from);
    // The note's change sends the page again to everyone who has it open.
  }
}
