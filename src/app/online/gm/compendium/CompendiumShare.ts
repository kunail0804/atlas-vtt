import {
  isRecord, parsePageEdit, parsePlayerMessage, type CompendiumAccess, type GmMessage, type PageEdit, type SharedPage, type SharedPageContent,
} from '../../protocol/index.ts';
import { hashText } from '../../../utils/hashing';
import { MoveRate } from '../moveCheck.ts';
import { isPlayerCompendiumType } from '../../protocol/compendium.ts';
import type { PickKind } from '../../../compendium/pickKinds';

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
  /** The name of the player of the table seated under this id; null for anyone the table does not seat. */
  nameOf(player: string): string | null;
  /** The pages shared with a player of the table now, by their id. */
  sharesOf(playerId: string): readonly PlayerShare[];
  /** The title, kind and book of a note, from what the vault knows of it now; null for a note that is gone. */
  describe(path: string): { title: string; kind: string; source?: string; system?: string } | null;
  read(path: string): Promise<PageRead | null>;
  /** Writes a player's change into the note: only the properties of `allowed`. False where it failed. */
  write(path: string, edit: PageEdit, allowed: readonly string[]): Promise<boolean>;
  now(): number;
  /** The vault path of the character sheet of the character a player at the table plays; null for none. */
  sheetOf?(player: string): string | null;
  /** The entries of a kind a sheet may take, by vault path. */
  sheetChoices?(kind: PickKind, sheet: string): Promise<readonly { path: string; name: string; detail?: string }[]>;
  /** Takes an entry into a sheet (and its book); false where it was refused. */
  pick?(sheet: string, kind: PickKind, entry: string): Promise<boolean>;
  /** The entry of that kind and name in the campaign's books, by vault path; null for none. */
  findEntry?(kind: PickKind, name: string): Promise<string | null>;
  /** The entries a sheet names (its spells, its weapons): its player reads them in their list. */
  sheetLinks?(sheet: string): readonly string[];
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
 * The compendium pages the GM shares, for a running table. The relay seats a player under the id of
 * their place at the table, however they took it (their own code, a key their browser kept, a new
 * device the GM let in), and the pages shared with that player of the table are theirs: a player
 * connected is sent their list, again whenever it changes, and a page whole when they open it, again
 * when its note changes. Someone the table does not seat gets nothing, whatever name they give; the
 * device key a player's page still sends (`identify`) only asks for the list again. A change a
 * player may make arrives in parts and is written into the note once whole; their access is looked
 * at again then, never taken from when they opened it.
 */
export class CompendiumShare {
  /** The players connected, by relay id: the id of their place at the table. */
  private readonly present = new Set<string>();
  /** The pages each was last sent in their list, by page id. */
  private readonly listed = new Map<string, Map<string, PlayerShare>>();
  private readonly sentLists = new Map<string, string>();
  private readonly opened = new Map<string, Set<string>>();
  private readonly assemblies = new Map<string, Assembly>();
  private readonly rate = new MoveRate(PAGE_BURST, PAGES_PER_SECOND);
  /** The entries last offered to each player for their sheet, by the id they were offered under. */
  private readonly offered = new Map<string, Map<string, { kind: PickKind; path: string }>>();
  /** The entries each player opened from their sheet to read, by page id: read while they sit here. */
  private readonly viewable = new Map<string, Map<string, string>>();

  constructor(private readonly ports: CompendiumSharePorts) {}

  /** A player's message: true when it was the compendium's. */
  receive(from: string, body: unknown): boolean {
    if (!isRecord(body) || !isPlayerCompendiumType(body.t)) return false;
    const message = parsePlayerMessage(body);
    if (message?.t === 'identify') this.playerJoined(from);
    else if (message?.t === 'sheet-choices') void this.offer(from, message.kind);
    else if (message?.t === 'sheet-pick') void this.take(from, message.kind, message.id);
    else if (message?.t === 'sheet-view') void this.view(from, message.kind, message.name);
    else if (message?.t === 'compendium-open') this.open(from, message.id);
    else if (message?.t === 'compendium-edit') this.part(from, message.id, message.edit, message.index, message.count, message.data);
    return true;
  }

  /** The relay's welcome: exactly these players are connected, and each is sent their pages. */
  welcome(players: readonly string[]): void {
    for (const player of [...this.present]) if (!players.includes(player)) this.playerLeft(player);
    for (const player of players) this.playerJoined(player);
  }

  /** A player the relay let in: they are sent the pages of their place, if the table seats them. */
  playerJoined(player: string): void {
    this.present.add(player);
    this.update(player);
  }

  /** The table's players or the shares changed: every list and open page follows. */
  sharesChanged(): void {
    for (const player of this.present) this.update(player);
  }

  /** A note changed: whoever has it in their list is sent the list, and the page if they opened it. */
  noteChanged(path: string): void {
    const id = pageIdOf(path);
    for (const [player, pages] of this.listed) {
      // Their sheet changed: the entries it names are theirs to read now.
      if (this.ports.sheetOf?.(player) === path) {
        this.sendList(player);
        continue;
      }
      if (this.viewable.get(player)?.has(id) === true) void this.sendPage(player, id);
      if (!pages.has(id)) continue;
      this.sendList(player);
      if (this.opened.get(player)?.has(id) === true) void this.sendPage(player, id);
    }
  }

  playerLeft(player: string): void {
    this.present.delete(player);
    this.listed.delete(player);
    this.sentLists.delete(player);
    this.opened.delete(player);
    this.assemblies.delete(player);
    this.offered.delete(player);
    this.viewable.delete(player);
  }

  stop(): void {
    for (const player of [...this.present]) this.playerLeft(player);
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
    if (this.ports.nameOf(player) === null) {
      // No longer seated (taken off the table): what they were sent is taken back.
      if (this.listed.has(player)) this.ports.send({ t: 'compendium', pages: [] }, player);
      this.listed.delete(player);
      this.sentLists.delete(player);
      return;
    }
    const pages = new Map<string, PlayerShare>();
    const list: SharedPage[] = [];
    // What their sheet names is theirs to read, unless the GM shares more.
    const sheet = this.ports.sheetOf?.(player) ?? null;
    const linked = sheet === null ? [] : (this.ports.sheetLinks?.(sheet) ?? []);
    const shares: PlayerShare[] = [...this.ports.sharesOf(player)];
    for (const path of linked) if (!shares.some((share) => share.path === path)) shares.push({ path, access: 'read' });
    for (const share of shares) {
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
    if ((!this.listed.get(from)?.has(id) && !this.viewable.get(from)?.has(id)) || !this.rate.take(from, this.ports.now())) return;
    const opened = this.opened.get(from) ?? new Set<string>();
    opened.add(id);
    this.opened.set(from, opened);
    void this.sendPage(from, id);
  }

  /** The page's share now: in their list, or opened from their sheet to read. */
  private shareOf(player: string, id: string): PlayerShare | undefined {
    const listed = this.listed.get(player)?.get(id);
    if (listed !== undefined) return listed;
    const path = this.viewable.get(player)?.get(id);
    return path === undefined ? undefined : { path, access: 'read' };
  }

  private async sendPage(player: string, id: string, shown = false): Promise<void> {
    const share = this.shareOf(player, id);
    if (share === undefined) return;
    const read = await this.ports.read(share.path).catch(() => null);
    // Still theirs once read, with the access they have now.
    const now = this.shareOf(player, id);
    if (read === null || now === undefined) return;
    const described = this.ports.describe(share.path);
    const page: SharedPageContent = {
      id, title: read.title, kind: read.kind, access: now.access, ...read.content,
      ...(described?.source !== undefined && { source: described.source }), ...(described?.system !== undefined && { system: described.system }),
      ...(now.access === 'write' && { fields: read.fields }),
      ...(shown && { shown: true as const }),
    };
    this.ports.send({ t: 'compendium-entry', page }, player);
  }

  /** The entries of a kind the player's sheet may take, under ids of their own. */
  private async offer(from: string, kind: PickKind): Promise<void> {
    const sheet = this.ports.sheetOf?.(from) ?? null;
    if (sheet === null || this.ports.sheetChoices === undefined || !this.rate.take(from, this.ports.now())) {
      this.ports.send({ t: 'sheet-choices', kind, choices: [] }, from);
      return;
    }
    const found = await this.ports.sheetChoices(kind, sheet).catch(() => []);
    const offered = new Map<string, { kind: PickKind; path: string }>();
    const choices = found.map((choice) => {
      const id = pageIdOf(choice.path);
      offered.set(id, { kind, path: choice.path });
      return { id, name: choice.name, ...(choice.detail !== undefined && { detail: choice.detail }) };
    });
    this.offered.set(from, offered);
    this.ports.send({ t: 'sheet-choices', kind, choices }, from);
  }

  /** Takes an entry offered into the player's own sheet; the sheet and the book reach them as the GM's changes do. */
  private async take(from: string, kind: PickKind, id: string): Promise<void> {
    const offered = this.offered.get(from)?.get(id);
    const sheet = this.ports.sheetOf?.(from) ?? null;
    if (offered?.kind !== kind || sheet === null || this.ports.pick === undefined || !this.rate.take(from, this.ports.now())) return;
    await this.ports.pick(sheet, kind, offered.path).catch((error: unknown) => {
      console.error('[CompendiumShare] Taking an entry into a sheet failed:', error);
      return false;
    });
  }

  /** Opens to the player the entry their sheet names, for as long as they sit at the table. */
  private async view(from: string, kind: PickKind, name: string): Promise<void> {
    if (this.ports.sheetOf?.(from) == null || this.ports.findEntry === undefined || !this.rate.take(from, this.ports.now())) return;
    const path = await this.ports.findEntry(kind, name).catch(() => null);
    if (path === null) {
      this.ports.send({ t: 'compendium-missing', name }, from);
      return;
    }
    const id = pageIdOf(path);
    const viewable = this.viewable.get(from) ?? new Map<string, string>();
    viewable.set(id, path);
    this.viewable.set(from, viewable);
    await this.sendPage(from, id, true);
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
