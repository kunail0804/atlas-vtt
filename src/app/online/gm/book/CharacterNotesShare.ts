import type { FoundNote, GmMessage } from '../../protocol/index.ts';
import { every, type Timers } from '../companionTimers.ts';

/** The notes linked for a character's player, whose texts and images are named by the ids the asset store keeps them under. */
export interface ReadNotes {
  readonly notes: readonly FoundNote[];
  /** The notes' vault paths and their images', which a change of any of them sends the notes again. */
  readonly paths: readonly string[];
}

export interface CharacterNotesSharePorts extends Timers {
  send(body: GmMessage, to: string): void;
  /** The players connected now. */
  online(): readonly string[];
  /** The vault path of the statblock note of the character `player` plays now; null for none. */
  noteOf(player: string): string | null;
  /** The notes a character note links for its player now; none for a note that links none. */
  read(path: string): Promise<ReadNotes>;
}

/** How often each player's character is looked at again: the notes follow a token given or taken within this time. */
export const NOTES_POLL_MS = 500;

interface Sent {
  readonly path: string | null;
  readonly text: string;
  readonly read: ReadNotes | null;
}

/**
 * The notes the GM linked to each player's character (`atlas-player-notes` of its statblock note),
 * sent to that player alone, again whenever their character, its note or one of those notes changes.
 * Their texts and images reach players through the asset store, as every found note's do.
 */
export class CharacterNotesShare {
  private readonly sent = new Map<string, Sent>();
  /** Players whose notes are being read, and those owed another read once it is done. */
  private readonly reading = new Set<string>();
  private readonly again = new Set<string>();
  private stopPoll: (() => void) | null = null;

  constructor(private readonly ports: CharacterNotesSharePorts) {}

  start(): void {
    this.stopPoll ??= every(this.ports, NOTES_POLL_MS, () => this.update());
    this.update();
  }

  stop(): void {
    this.stopPoll?.();
    this.stopPoll = null;
    this.sent.clear();
  }

  /** Sends each connected player whose character is another now its notes. */
  update(): void {
    const online = new Set(this.ports.online());
    for (const player of [...this.sent.keys()]) if (!online.has(player)) this.sent.delete(player);
    for (const player of online) {
      const path = this.ports.noteOf(player);
      const sent = this.sent.get(player);
      if (sent === undefined || sent.path !== path) void this.refresh(player);
    }
  }

  /** A note changed: every player whose character's note it is, or one of its notes, is sent the notes again. */
  noteChanged(path: string): void {
    for (const [player, sent] of this.sent) if (sent.path === path || sent.read?.paths.includes(path) === true) void this.refresh(player);
  }

  /** Everything again, to one player or to all. */
  resend(to?: string): void {
    if (to === undefined) this.sent.clear();
    else this.sent.delete(to);
    this.update();
  }

  playerLeft(player: string): void {
    this.sent.delete(player);
  }

  /** Reads a player's notes and sends them when they are others than what they were sent; one read per player at a time. */
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
      const body: GmMessage = { t: 'character-notes', notes: read?.notes ?? [] };
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
