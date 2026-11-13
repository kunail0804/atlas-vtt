import { describe, expect, it } from 'vitest';
import { CompendiumShare, type CompendiumSharePorts, type PlayerShare } from '../../../../src/app/online/gm/compendium/CompendiumShare';
import type { GmMessage } from '../../../../src/app/online/protocol/index';

const ALICE = 'aaaaaaaaaaaaaaaaaaaa';
const STRANGER = 'zzzzzzzzzzzzzzzzzzzz';
const KEY_A = 'A'.repeat(43);
const KEY_B = 'B'.repeat(43);

/** A table whose seats and shares the test sets, and what was sent to whom. */
function table(): { share: CompendiumShare; seats: Map<string, string>; shares: Map<string, PlayerShare[]>; sent: Array<{ body: GmMessage; to: string }> } {
  const seats = new Map<string, string>();
  const shares = new Map<string, PlayerShare[]>();
  const sent: Array<{ body: GmMessage; to: string }> = [];
  const ports: CompendiumSharePorts = {
    send: (body, to) => sent.push({ body, to }),
    nameOf: (player) => seats.get(player) ?? null,
    sharesOf: (playerId) => shares.get(playerId) ?? [],
    describe: (path) => ({ title: path, kind: 'spell' }),
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(false),
    now: () => 0,
  };
  return { share: new CompendiumShare(ports), seats, shares, sent };
}

const listsTo = (sent: Array<{ body: GmMessage; to: string }>, to: string): string[][] =>
  sent.filter((message) => message.to === to && message.body.t === 'compendium').map((message) => (message.body.t === 'compendium' ? message.body.pages.map((page) => page.title) : []));

describe('compendium pages follow the seat', () => {
  it('a player shared with before they ever connected gets their pages when they take their place', () => {
    const { share, seats, shares, sent } = table();
    seats.set(ALICE, 'Alice');
    shares.set(ALICE, [{ path: 'Spells/Fireball.md', access: 'read' }]);
    share.playerJoined(ALICE);
    expect(listsTo(sent, ALICE)).toEqual([['Spells/Fireball.md']]);
  });

  it('a player back from a new device the GM let in finds their pages, whatever key it sends', () => {
    const { share, seats, shares, sent } = table();
    seats.set(ALICE, 'Alice');
    shares.set(ALICE, [{ path: 'Spells/Fireball.md', access: 'write' }]);
    share.playerJoined(ALICE);
    share.receive(ALICE, { t: 'identify', key: KEY_A });
    share.playerLeft(ALICE);
    // The relay seats the new browser in Alice's place: same id, another device key.
    share.playerJoined(ALICE);
    share.receive(ALICE, { t: 'identify', key: KEY_B });
    expect(listsTo(sent, ALICE)).toEqual([['Spells/Fireball.md'], ['Spells/Fireball.md']]);
  });

  it('a device the table does not seat gets nothing, even under the name of a player', () => {
    const { share, seats, shares, sent } = table();
    seats.set(ALICE, 'Alice');
    shares.set(ALICE, [{ path: 'Spells/Fireball.md', access: 'read' }]);
    // Refused at the door, yet connected and claiming to be Alice with her key.
    share.playerJoined(STRANGER);
    expect(share.receive(STRANGER, { t: 'identify', key: KEY_A })).toBe(true);
    share.receive(STRANGER, { t: 'compendium-open', id: 'anything' });
    expect(sent.filter((message) => message.to === STRANGER)).toEqual([]);
  });

  it('a player taken off the table loses the pages they were sent', () => {
    const { share, seats, shares, sent } = table();
    seats.set(ALICE, 'Alice');
    shares.set(ALICE, [{ path: 'Spells/Fireball.md', access: 'read' }]);
    share.playerJoined(ALICE);
    seats.delete(ALICE);
    share.sharesChanged();
    expect(listsTo(sent, ALICE)).toEqual([['Spells/Fireball.md'], []]);
  });

  it('a welcome sends each seated player their pages and forgets who is gone', () => {
    const { share, seats, shares, sent } = table();
    seats.set(ALICE, 'Alice');
    shares.set(ALICE, [{ path: 'Spells/Shield.md', access: 'read' }]);
    share.welcome([ALICE, STRANGER]);
    share.welcome([]);
    shares.set(ALICE, []);
    share.sharesChanged();
    expect(listsTo(sent, ALICE)).toEqual([['Spells/Shield.md']]);
    expect(sent.filter((message) => message.to === STRANGER)).toEqual([]);
  });
});
