import type { GmMessage, SharedBar } from '../protocol/index.ts';

/** Who is connected and who owns which token. */
export interface MineSource {
  /** The ids of the players connected now. */
  onlinePlayers(): readonly string[];
  /** The owner of a token of the GM's scene, by its GM id. */
  ownerOf(tokenId: string): string | undefined;
}

/** The token list players were last sent: its scene, and the random id players know each token by, by GM id. */
export interface ListedTokens {
  readonly scene: string;
  readonly aliases: ReadonlyMap<string, string>;
}

/** The ids, as players know them, of the listed tokens that are the player's, sorted. */
export function mineOf(player: string, listed: ListedTokens, ownerOf: (tokenId: string) => string | undefined): string[] {
  return [...listed.aliases].filter(([tokenId]) => ownerOf(tokenId) === player).map(([, alias]) => alias).sort();
}

/**
 * Tells each connected player which tokens of the last list are theirs, with the bars of those as
 * their owner sees them: a `mine` message to that player alone, whenever their share changes. Only
 * tokens in the list are named, so a hidden token a player owns stays unknown to them.
 */
export class MineShare {
  private readonly source: MineSource;
  private readonly send: (body: GmMessage, to: string) => void;
  /** The bars of a token of the GM's scene as its owner sees them, by its GM id; without it none are sent. */
  private readonly barsOf: (tokenId: string) => readonly SharedBar[];
  private listed: ListedTokens | null = null;
  /** What each player was last sent: scene and ids. */
  private readonly sent = new Map<string, string>();

  constructor(source: MineSource, send: (body: GmMessage, to: string) => void, barsOf: (tokenId: string) => readonly SharedBar[] = () => []) {
    this.source = source;
    this.send = send;
    this.barsOf = barsOf;
  }

  /** The list players were just sent, or null while no scene's tokens are shared. */
  setList(listed: ListedTokens | null): void {
    this.listed = listed;
    this.update();
  }

  /** Sends each connected player their share where it changed. */
  update(): void {
    const listed = this.listed;
    if (listed === null) return;
    const online = new Set(this.source.onlinePlayers());
    for (const player of this.sent.keys()) if (!online.has(player)) this.sent.delete(player);
    for (const player of online) {
      const tokens = mineOf(player, listed, (tokenId) => this.source.ownerOf(tokenId));
      const bars = this.ownBars(listed, tokens);
      const key = JSON.stringify([listed.scene, tokens, bars]);
      if (this.sent.get(player) === key) continue;
      this.sent.set(player, key);
      this.send({ t: 'mine', scene: listed.scene, tokens, ...(bars !== null && { bars }) }, player);
    }
  }

  /** The bars of `tokens` (ids as players know them) that have some, by id; null where none has. */
  private ownBars(listed: ListedTokens, tokens: readonly string[]): Record<string, readonly SharedBar[]> | null {
    const gmIds = new Map([...listed.aliases].map(([tokenId, alias]) => [alias, tokenId]));
    const bars: Record<string, readonly SharedBar[]> = {};
    let any = false;
    for (const alias of tokens) {
      const tokenId = gmIds.get(alias);
      const list = tokenId === undefined ? [] : this.barsOf(tokenId);
      if (list.length === 0) continue;
      bars[alias] = list;
      any = true;
    }
    return any ? bars : null;
  }

  /** Sends the shares again, to one player or to all. */
  resend(to?: string): void {
    if (to === undefined) this.sent.clear();
    else this.sent.delete(to);
    this.update();
  }
}
