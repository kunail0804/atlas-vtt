import { describe, expect, it } from 'vitest';
import {
  EMPTY_ROSTER, addPlayer, dropPath, identifyDevice, mergePlayers, movePath, parseRoster, removePlayer, serializeRoster,
  setShares, sharesOf, type Roster,
} from '../../../src/app/players/roster';

const D1 = 'a'.repeat(64);
const D2 = 'b'.repeat(64);
const ids = (...list: string[]): (() => string) => () => list.shift() ?? 'p00000000';

describe('the vault\'s players', () => {
  it('know a device again, and make a new player of a device never seen', () => {
    const first = identifyDevice(EMPTY_ROSTER, D1, '  Alice  ', 5, ids('p11111111'));
    expect(first.id).toBe('p11111111');
    expect(first.roster.players.p11111111).toEqual({ name: 'Alice', devices: [D1], createdAt: 5 });
    const again = identifyDevice(first.roster, D1, 'Someone else', 6, ids('p22222222'));
    expect(again).toEqual({ roster: first.roster, id: 'p11111111' });
  });

  it('give a device to the player the GM made under that name, once', () => {
    const made = addPlayer(EMPTY_ROSTER, 'Bob', 1, ids('p33333333'));
    const joined = identifyDevice(made.roster, D1, 'bob', 2, ids('p44444444'));
    expect(joined.id).toBe('p33333333');
    expect(joined.roster.players.p33333333?.devices).toEqual([D1]);
    // Bob has a device now: another device named Bob is someone new.
    expect(identifyDevice(joined.roster, D2, 'Bob', 3, ids('p55555555')).id).toBe('p55555555');
  });

  it('share notes in a batch, change the access, and take it back', () => {
    let roster: Roster = addPlayer(addPlayer(EMPTY_ROSTER, 'Alice', 1, ids('p11111111')).roster, 'Bob', 1, ids('p22222222')).roster;
    roster = setShares(roster, ['A.md', 'B.md'], { p11111111: 'read', p22222222: 'write' });
    expect(sharesOf(roster, 'p11111111')).toEqual([{ path: 'A.md', access: 'read' }, { path: 'B.md', access: 'read' }]);
    roster = setShares(roster, ['B.md'], { p11111111: 'write', p22222222: null });
    expect(roster.shares).toEqual({ 'A.md': { p11111111: 'read', p22222222: 'write' }, 'B.md': { p11111111: 'write' } });
    roster = setShares(roster, ['B.md'], { p11111111: null, nobody: 'read' });
    expect(roster.shares['B.md']).toBeUndefined();
  });

  it('end a player\'s shares only when the player is removed', () => {
    let roster = addPlayer(EMPTY_ROSTER, 'Alice', 1, ids('p11111111')).roster;
    roster = setShares(roster, ['A.md'], { p11111111: 'read' });
    expect(parseRoster(serializeRoster(roster))).toEqual(roster);
    roster = removePlayer(roster, 'p11111111');
    expect(roster).toEqual(EMPTY_ROSTER);
  });

  it('merge two players into one, devices and pages, keeping the wider access', () => {
    let roster = identifyDevice(EMPTY_ROSTER, D1, 'Alice', 1, ids('p11111111')).roster;
    roster = identifyDevice(roster, D2, 'Alice (phone)', 2, ids('p22222222')).roster;
    roster = setShares(roster, ['A.md'], { p11111111: 'read', p22222222: 'write' });
    roster = setShares(roster, ['B.md'], { p22222222: 'read' });
    roster = mergePlayers(roster, 'p22222222', 'p11111111');
    expect(Object.keys(roster.players)).toEqual(['p11111111']);
    expect(roster.players.p11111111?.devices).toEqual([D1, D2]);
    expect(roster.shares).toEqual({ 'A.md': { p11111111: 'write' }, 'B.md': { p11111111: 'read' } });
  });

  it('follow notes and folders that move, and forget those deleted', () => {
    let roster = addPlayer(EMPTY_ROSTER, 'Alice', 1, ids('p11111111')).roster;
    roster = setShares(roster, ['Compendium/X/Spells/Fire.md', 'Other.md'], { p11111111: 'read' });
    roster = movePath(roster, 'Compendium/X', 'Compendium/Y');
    expect(Object.keys(roster.shares).sort()).toEqual(['Compendium/Y/Spells/Fire.md', 'Other.md']);
    roster = dropPath(roster, 'Compendium/Y/Spells');
    expect(Object.keys(roster.shares)).toEqual(['Other.md']);
  });

  it('read a damaged file as far as it can', () => {
    expect(parseRoster('not json')).toEqual(EMPTY_ROSTER);
    const roster = parseRoster(JSON.stringify({ players: { p11111111: { name: 'Alice', devices: [D1, 'short'] }, bad: { name: 'X' } }, shares: { 'A.md': { p11111111: 'write', bad: 'read', p22222222: 'read' }, 'B.md': { p11111111: 'admin' } } }));
    expect(roster).toEqual({ players: { p11111111: { name: 'Alice', devices: [D1], createdAt: 0 } }, shares: { 'A.md': { p11111111: 'write' } } });
  });
});
