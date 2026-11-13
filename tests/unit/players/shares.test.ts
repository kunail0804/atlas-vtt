import { describe, expect, it } from 'vitest';
import { migrateLegacyShares, parseShares, serializeShares, setShares, sharedWith, sharesOf, NO_SHARES } from '../../../src/app/players/shares';

const ALICE = 'aaaaaaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbbbbbb';
const OTHER_BOB = 'cccccccccccccccccccc';

/** A players.json as Atlas wrote it before the shares followed the table's players. */
const legacyFile = JSON.stringify({
  format: 1,
  players: {
    p11111111: { name: 'Alice', devices: ['a'.repeat(64)], createdAt: 1 },
    p22222222: { name: 'alice', devices: ['b'.repeat(64)], createdAt: 2 },
    p33333333: { name: 'Bob', devices: [], createdAt: 3 },
    p44444444: { name: 'Carol', devices: [], createdAt: 4 },
  },
  shares: {
    'Compendium/Spells/Fireball.md': { p11111111: 'read', p22222222: 'write', p44444444: 'read' },
    'Compendium/Spells/Shield.md': { p33333333: 'read' },
    'Compendium/Spells/Light.md': { p44444444: 'write' },
  },
});

describe('page shares', () => {
  it('shares a page with a player of the table who never connected', () => {
    const shared = setShares(NO_SHARES, ['Notes/Map.md'], { [ALICE]: 'read' });
    expect(sharesOf(shared, ALICE)).toEqual([{ path: 'Notes/Map.md', access: 'read' }]);
    expect(sharedWith(shared, 'Notes/Map.md', [{ id: ALICE, name: 'Alice' }, { id: BOB, name: 'Bob' }])).toEqual([{ id: ALICE, name: 'Alice', access: 'read' }]);
    expect(parseShares(serializeShares(shared))).toEqual({ shares: shared, legacy: null });
  });

  it('keeps no players or devices of its own', () => {
    const text = serializeShares(setShares(NO_SHARES, ['Notes/Map.md'], { [ALICE]: 'write', 'not an id': 'read' }));
    expect(JSON.parse(text)).toEqual({ format: 2, shares: { 'Notes/Map.md': { [ALICE]: 'write' } } });
  });

  it('leaves out a player no longer at the table where it names who has a page', () => {
    const shared = setShares(NO_SHARES, ['Notes/Map.md'], { [ALICE]: 'read', [BOB]: 'write' });
    expect(sharedWith(shared, 'Notes/Map.md', [{ id: BOB, name: 'Bob' }])).toEqual([{ id: BOB, name: 'Bob', access: 'write' }]);
  });
});

describe('carrying the old shares over', () => {
  it('reads a file of format 1 as shares to carry over', () => {
    const { shares, legacy } = parseShares(legacyFile);
    expect(shares).toBe(NO_SHARES);
    expect(legacy?.names).toEqual({ p11111111: 'Alice', p22222222: 'alice', p33333333: 'Bob', p44444444: 'Carol' });
  });

  it('gives each share to the one player of the table of the same name, and drops and counts the others', () => {
    const { legacy } = parseShares(legacyFile);
    if (legacy === null) throw new Error('A file of format 1 has shares to carry over.');
    const { shares, dropped } = migrateLegacyShares(legacy, [
      { id: ALICE, name: 'ALICE' },
      { id: BOB, name: 'Bob' },
      { id: OTHER_BOB, name: 'bob' },
    ]);
    // Both Alices of the old list were one person: she keeps the wider access.
    expect(shares.shares).toEqual({ 'Compendium/Spells/Fireball.md': { [ALICE]: 'write' } });
    // Carol has no player at the table; Bob has two.
    expect(dropped).toBe(3);
  });

  it('drops every share where the table has no players', () => {
    const { legacy } = parseShares(legacyFile);
    if (legacy === null) throw new Error('A file of format 1 has shares to carry over.');
    expect(migrateLegacyShares(legacy, [])).toEqual({ shares: NO_SHARES, dropped: 5 });
  });
});
