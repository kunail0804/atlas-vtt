import type { PlayersBlock, TablePlayers } from '../../campaigns/players/TablePlayers';
import { newLinkCode, newPlayerCode, withCharacterOwner, withLink, withPlayer, type CampaignPlayer, type StoredPlayers } from '../../campaigns/players/playersFile';
import { earlierIdsOf } from '../../campaigns/players/tablePlayersFile';
import { withPlayerTokens, withTokenOwners, type TokenAssignments } from '../../campaigns/players/tokenAssignments';
import { MAX_CAMPAIGN_PLAYERS, MAX_SEAT_ALIASES, samePlayerName, type CampaignSeat, type PlayerInfo } from '../protocol/index.ts';
import { showNotice } from '../../ui/notice';
import type { CampaignSeats } from './ownership.ts';
import { t } from '../../i18n';

/** What a table needs of its players file: `TablePlayers`, or memory in tests. */
export type PlayersFiles = Pick<TablePlayers, 'roster' | 'assignments' | 'migratedIds' | 'change' | 'blocked' | 'onChange'>;

/** What the GM reads where something needs the played campaign, which only a running table plays. */
export const NO_TABLE_TEXT = t('online.seats.noTable');

/** What the GM reads where the table's players file cannot be written. */
export const NEWER_PLAYERS_TEXT = t('online.seats.newer');

/** What the GM reads where the campaigns or the table's players file are not read yet. */
export const CAMPAIGNS_LOADING_TEXT = t('online.seats.loading');

/** What the GM reads, by why the table's players file cannot be changed. */
const BLOCKED_TEXTS: Readonly<Record<PlayersBlock, string>> = {
  loading: CAMPAIGNS_LOADING_TEXT,
  newer: NEWER_PLAYERS_TEXT,
};

/**
 * The players of the table, as its players file holds them whatever world it plays: who plays which
 * character and the tokens it assigns (for `Ownership`), the players and their own codes the relay is
 * told, and the file's link. Every change of that file, another device's too, is told to the listeners.
 */
export class TableSeats implements CampaignSeats {
  constructor(private readonly files: PlayersFiles) {}

  players(): readonly CampaignPlayer[] {
    return this.files.roster().players;
  }

  /** The table's code, once it has one. */
  link(): string | null {
    return this.files.roster().link;
  }

  /** Why the players file cannot be changed now, for the GM to read; null where it can. */
  refusal(): string | null {
    const blocked = this.files.blocked();
    return blocked === null ? null : BLOCKED_TEXTS[blocked];
  }

  /**
   * The players as the relay is told them: id, name and own code, and the ids a player had in the
   * worlds before the players were merged, so a key the relay gave under one of them finds the player.
   */
  seats(): CampaignSeat[] {
    const ids = this.files.migratedIds();
    return this.players().map(({ id, name, code }) => {
      const was = earlierIdsOf(ids, id).slice(0, MAX_SEAT_ALIASES);
      return was.length === 0 ? { id, name, code } : { id, name, code, was };
    });
  }

  /** Whether a player other than `except` goes by this name. */
  nameTaken(name: string, except?: string): boolean {
    return this.players().some((player) => player.id !== except && samePlayerName(player.name, name));
  }

  /** Every player's own code. */
  codes(): Set<string> {
    return new Set(this.players().map((player) => player.code));
  }

  /** A player's own code, or null for anyone the campaign does not know. */
  codeOf(playerId: string): string | null {
    return this.players().find((player) => player.id === playerId)?.code ?? null;
  }

  /**
   * Changes the players file; false where it cannot be written (`refusal`). `change` must be a pure
   * function of the file: it runs again on what the disk holds once the write lands.
   */
  change(change: (stored: StoredPlayers) => StoredPlayers): boolean {
    return this.files.change(change);
  }

  /** Gives the character to the player, or to nobody (null); tells the GM where the file cannot be written. */
  setOwner(characterId: string, playerId: string | null): void {
    this.write((stored) => withCharacterOwner(stored, characterId, playerId));
  }

  /** The tokens the table assigns: owners of tokens placed from no library token, and the GM's player tokens per scene. */
  assignments(): TokenAssignments {
    return this.files.assignments();
  }

  /** Gives tokens placed from no library token to the player, or to nobody (null); tells the GM where the file cannot be written. */
  setTokenOwners(tokenIds: readonly string[], playerId: string | null): void {
    this.write((stored) => withTokenOwners(stored, tokenIds, playerId));
  }

  /** Makes tokens of the scene at `mapPath` player tokens, or the GM's own; false, and the GM is told, where the file cannot be written. */
  markPlayerTokens(mapPath: string, tokenIds: readonly string[], player: boolean): boolean {
    return this.write((stored) => withPlayerTokens(stored, mapPath, tokenIds, player));
  }

  /** Calls the listener after every change of the players file; returns the way to stop. */
  onChange(listener: () => void): () => void {
    const read = (): string => JSON.stringify([this.files.roster(), this.assignments(), this.files.migratedIds()]);
    let last = read();
    return this.files.onChange(() => {
      const now = read();
      if (now === last) return;
      last = now;
      listener();
    });
  }

  /** Changes the players file; where it cannot be written the GM is told why. */
  private write(change: (stored: StoredPlayers) => StoredPlayers): boolean {
    const written = this.change(change);
    if (!written) showNotice(this.refusal() ?? NEWER_PLAYERS_TEXT);
    return written;
  }
}

/**
 * Makes `player` (whom the relay let in) a player of the table, playing nothing yet, with a code
 * of their own that no other player has and that is not the table's join code `joinCode`; null
 * where another player goes by their name, the table has no room for them or its file cannot be
 * written, and nothing is changed.
 */
export function admitNewcomer(seats: TableSeats, player: PlayerInfo, joinCode: string, random?: () => number): CampaignPlayer | null {
  if (seats.nameTaken(player.name) || seats.players().length >= MAX_CAMPAIGN_PLAYERS || seats.refusal() !== null) return null;
  const taken = seats.codes().add(joinCode);
  const admitted: CampaignPlayer = { id: player.id, name: player.name, code: newPlayerCode(taken, random), characters: [] };
  const now = Date.now();
  return seats.change((stored) => withPlayer(stored, admitted, now)) ? admitted : null;
}

/** What the GM reads where another player of the table goes by `name`. */
export const nameTakenText = (name: string): string => t('online.seats.nameTaken', { name });

/** What the GM reads when `name` could not be made a player of the table. */
export function refusalText(seats: TableSeats, name: string): string {
  return seats.refusal() ?? (seats.nameTaken(name) ? nameTakenText(name) : t('online.seats.full', { name }));
}

/** Gives the table a new link in its players file; false where the file cannot be written. */
export function renewLink(seats: TableSeats): boolean {
  const link = newLinkCode();
  return seats.change((stored) => withLink(stored, link));
}

/** The table's link, made and kept in its players file where it has none yet; null where it cannot be kept. */
export const campaignLink = (seats: TableSeats): string | null => seats.link() ?? (renewLink(seats) ? seats.link() : null);

/** What the GM reads where the table's link cannot be kept. */
export const linkRefusal = (seats: TableSeats): string => seats.refusal() ?? NEWER_PLAYERS_TEXT;
