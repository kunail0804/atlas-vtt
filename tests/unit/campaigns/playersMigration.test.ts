import { describe, expect, it } from 'vitest';
import { mergeWorldPlayers, type WorldPlayers } from '../../../src/app/campaigns/players/playersMigration';
import { readPlayers, type StoredPlayers } from '../../../src/app/campaigns/players/playersFile';
import { readMigratedIds } from '../../../src/app/campaigns/players/tablePlayersFile';
import { readTokenAssignments } from '../../../src/app/campaigns/players/tokenAssignments';
import { MAX_CAMPAIGN_PLAYERS, PLAYER_ID_PATTERN } from '../../../src/app/online/protocol/index.ts';

/** A player id made of one letter. */
const pid = (letter: string): string => letter.repeat(20);

interface Seat { readonly name: string; readonly code: string; readonly characters?: readonly string[]; readonly addedAt?: number }

function world(campaignId: string, lastPlayed: number, players: Record<string, Seat>, extra: Record<string, unknown> = {}): WorldPlayers {
  const stored: StoredPlayers = { id: campaignId, campaignId, players: Object.fromEntries(Object.entries(players).map(([id, seat]) => [id, { characters: [], ...seat }])), ...extra };
  return { stored, lastPlayed };
}

function merged(worlds: readonly WorldPlayers[]): StoredPlayers {
  const result = mergeWorldPlayers(worlds);
  if (result === null) throw new Error('nothing merged');
  return result;
}

describe('merging the worlds\' players', () => {
  it('makes one player of two of one name, with the id and code of the one added first and both worlds\' characters', () => {
    const result = merged([
      world('c1', 200, { [pid('a')]: { name: 'Ana', code: '111111', characters: ['hero'], addedAt: 50 } }),
      world('c2', 100, { [pid('b')]: { name: 'ANA', code: '222222', characters: ['bard'], addedAt: 10 } }),
    ]);
    expect(readPlayers(result)).toEqual([{ id: pid('b'), name: 'ANA', code: '222222', characters: ['hero', 'bard'] }]);
    expect(readMigratedIds(result)).toEqual({ c1: { [pid('a')]: pid('b') }, c2: { [pid('b')]: pid('b') } });
  });

  it('tells two players added at once apart by their id', () => {
    const result = merged([
      world('c1', 200, { [pid('z')]: { name: 'Ana', code: '111111', addedAt: 10 } }),
      world('c2', 100, { [pid('b')]: { name: 'Ana', code: '222222', addedAt: 10 } }),
    ]);
    expect(readPlayers(result).map((player) => player.id)).toEqual([pid('b')]);
  });

  it('gives a character two players play to the one of the world played last', () => {
    const result = merged([
      world('c1', 100, { [pid('a')]: { name: 'Ana', code: '111111', characters: ['hero'], addedAt: 1 } }),
      world('c2', 300, { [pid('b')]: { name: 'Bo', code: '222222', characters: ['hero', 'bard'], addedAt: 2 } }),
    ]);
    expect(readPlayers(result)).toEqual([
      { id: pid('a'), name: 'Ana', code: '111111', characters: [] },
      { id: pid('b'), name: 'Bo', code: '222222', characters: ['hero', 'bard'] },
    ]);
  });

  it('keeps the link of the world played last that has one', () => {
    const players = { [pid('a')]: { name: 'Ana', code: '111111' } };
    const result = merged([
      world('c1', 100, players, { link: 'o'.repeat(26) }),
      world('c2', 300, {}, {}),
      world('c3', 200, players, { link: 'n'.repeat(26) }),
    ]);
    expect(result.link).toBe('n'.repeat(26));
  });

  it('carries the assigned tokens, owners by their new ids, the world played last deciding where two differ', () => {
    const result = merged([
      world('c1', 100, { [pid('a')]: { name: 'Ana', code: '111111', addedAt: 5 } }, { tokenOwners: { t1: pid('a'), t2: pid('a'), lost: pid('x') }, playerTokens: { 'Scenes/Cave.atlasmap': { t1: true, t3: true } } }),
      world('c2', 300, { [pid('b')]: { name: 'Ana', code: '222222', addedAt: 1 }, [pid('c')]: { name: 'Cy', code: '333333', addedAt: 2 } }, { tokenOwners: { t1: pid('c') }, playerTokens: { 'Scenes/Cave.atlasmap': { t3: false } } }),
    ]);
    expect(readTokenAssignments(result)).toEqual({
      owners: { t1: pid('c'), t2: pid('b') },
      playerTokens: { 'Scenes/Cave.atlasmap': { t3: false, t1: true } },
    });
  });

  it('gives the same file whatever order the worlds are read in', () => {
    const worlds = [
      world('c1', 100, { [pid('a')]: { name: 'Ana', code: '111111', characters: ['x'], addedAt: 5 } }, { link: 'o'.repeat(26) }),
      world('c2', 100, { [pid('b')]: { name: 'ana', code: '222222', characters: ['x', 'y'], addedAt: 5 } }),
      world('c3', 400, { [pid('c')]: { name: 'Cy', code: '333333' } }, { link: 'n'.repeat(26) }),
    ];
    const once = JSON.stringify(merged(worlds));
    expect(JSON.stringify(merged([...worlds].reverse()))).toBe(once);
    expect(JSON.stringify(merged([worlds[1] as WorldPlayers, worlds[2] as WorldPlayers, worlds[0] as WorldPlayers]))).toBe(once);
  });

  it('gives a player whose id or code another player already has one of their own, the same each time', () => {
    const worlds = [
      world('c1', 200, { [pid('a')]: { name: 'Ana', code: '111111', addedAt: 1 } }),
      // A copied world whose player was renamed: the same id and code, another player.
      world('c2', 100, { [pid('a')]: { name: 'Bo', code: '111111', addedAt: 2 } }),
    ];
    const result = merged(worlds);
    const players = readPlayers(result);
    expect(players).toHaveLength(2);
    const bo = players.find((player) => player.name === 'Bo');
    expect(bo?.id).not.toBe(pid('a'));
    expect(bo?.id).toMatch(PLAYER_ID_PATTERN);
    expect(bo?.code).not.toBe('111111');
    expect(bo?.code).toMatch(/^\d{6}$/);
    expect(readMigratedIds(result)).toEqual({ c1: { [pid('a')]: pid('a') }, c2: { [pid('a')]: bo?.id } });
    expect(JSON.stringify(merged(worlds))).toBe(JSON.stringify(result));
  });

  it('keeps the players added first where the worlds have more than a table seats', () => {
    const players = Object.fromEntries(Array.from({ length: MAX_CAMPAIGN_PLAYERS + 2 }, (_, index) => {
      const id = `${'p'.repeat(18)}${'abcdefghijklmnopqrstuvwxyz'[Math.floor(index / 26)]}${'abcdefghijklmnopqrstuvwxyz'[index % 26]}`;
      return [id, { name: `P${index}`, code: String(index).padStart(6, '0'), addedAt: index }];
    }));
    const result = merged([world('c1', 1, players)]);
    expect(readPlayers(result)).toHaveLength(MAX_CAMPAIGN_PLAYERS);
    expect(readPlayers(result).map((player) => player.name)).not.toContain(`P${MAX_CAMPAIGN_PLAYERS}`);
    expect(Object.keys(readMigratedIds(result).c1 ?? {})).toHaveLength(MAX_CAMPAIGN_PLAYERS);
  });

  it('carries nothing where no world has a player, a link or an assigned token', () => {
    expect(mergeWorldPlayers([])).toBeNull();
    expect(mergeWorldPlayers([world('c1', 1, {})])).toBeNull();
  });
});
