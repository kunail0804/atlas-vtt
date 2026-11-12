import { describe, expect, it } from 'vitest';
import { armorClassWith, gearOf, pickResult, wornGear } from '../../../src/app/compendium/sheetPickEdits';
import type { BookItem } from '../../../src/app/online/protocol/book';
import type { NotePatch } from '../../../src/app/statblocks/notes/patchTypes';

type Frontmatter = Record<string, unknown>;

const SHIELD: Frontmatter = { 'item-type': 'shield', 'armor-category': 'Shield', 'armor-class': 2 };
const CHAIN_SHIRT: Frontmatter = { 'item-type': 'armor', 'armor-category': 'Medium', 'armor-class': 13, 'dex-bonus': true, 'max-dex-bonus': 2 };
const CHAIN_MAIL: Frontmatter = { 'item-type': 'armor', 'armor-category': 'Heavy', 'armor-class': 16, 'dex-bonus': false };
/** Dexterity 18 (+4), which a medium armour caps at +2. */
const note = (ac?: number): Frontmatter => ({ stats: [10, 18, 10, 10, 10, 10], ...(ac !== undefined && { ac }) });

const bookItem = (id: string, name: string, frontmatter: Frontmatter): BookItem => {
  const gear = gearOf('armor', name, frontmatter, '');
  if (gear === null) throw new Error('no gear');
  return { ...gear.item, id, tone: null, at: 0 };
};

/** A book with these items, each worn in its slot. */
const book = (worn: readonly [slot: string, item: BookItem][]): { items: BookItem[]; equipped: { slot: string; item: string }[] } => ({
  items: worn.map(([, item]) => item),
  equipped: worn.map(([slot, item]) => ({ slot, item: item.id })),
});

/** The armour class a pick writes into the note, or undefined where it writes none. */
const acWritten = (patches: readonly NotePatch[]): unknown => {
  for (const patch of patches) if (patch.op === 'set' && patch.path[0] === 'ac') return patch.next;
  return undefined;
};

describe('armour class of an armour or a shield taken from the compendium', () => {
  it('counts a shield once, however often it is picked', () => {
    const shield = bookItem('s1', 'Shield', SHIELD);
    const first = pickResult('armor', 'Shield', SHIELD, note(15), wornGear(book([['off-hand', shield]]), 's1'));
    expect(acWritten(first)).toBe(17);
    // The second shield finds the off hand taken: it is not worn and changes nothing.
    const again = bookItem('s2', 'Shield', SHIELD);
    const second = pickResult('armor', 'Shield', SHIELD, note(17), wornGear(book([['off-hand', shield]]), again.id));
    expect(acWritten(second)).toBeUndefined();
  });

  it('gives the armour, Dexterity up to its cap and the shield, armour then shield', () => {
    const armour = bookItem('a', 'Chain Shirt', CHAIN_SHIRT);
    const afterArmour = acWritten(pickResult('armor', 'Chain Shirt', CHAIN_SHIRT, note(), wornGear(book([['armour', armour]]), 'a')));
    expect(afterArmour).toBe(15);
    const shield = bookItem('s', 'Shield', SHIELD);
    const afterShield = pickResult('armor', 'Shield', SHIELD, note(15), wornGear(book([['armour', armour], ['off-hand', shield]]), 's'));
    expect(acWritten(afterShield)).toBe(17);
  });

  it('gives the armour, Dexterity up to its cap and the shield, shield then armour', () => {
    const shield = bookItem('s', 'Shield', SHIELD);
    const armour = bookItem('a', 'Chain Shirt', CHAIN_SHIRT);
    const result = pickResult('armor', 'Chain Shirt', CHAIN_SHIRT, note(12), wornGear(book([['off-hand', shield], ['armour', armour]]), 'a'));
    expect(acWritten(result)).toBe(17);
    expect(armorClassWith(CHAIN_MAIL, note(12), { equipped: true, shield: 2 })).toBe(18);
  });

  it('leaves the armour class alone for an armour that is not worn', () => {
    const worn = bookItem('a', 'Chain Mail', CHAIN_MAIL);
    const spare = bookItem('b', 'Chain Shirt', CHAIN_SHIRT);
    const taken = book([['armour', worn]]);
    expect(acWritten(pickResult('armor', 'Chain Shirt', CHAIN_SHIRT, note(16), wornGear({ ...taken, items: [...taken.items, spare] }, 'b')))).toBeUndefined();
    // No book kept (online play off, no token linked): nothing is worn.
    expect(acWritten(pickResult('armor', 'Chain Shirt', CHAIN_SHIRT, note(16), null))).toBeUndefined();
    expect(armorClassWith(CHAIN_SHIRT, note(16), { equipped: false, shield: null })).toBeNull();
  });

  it('reads a shield in the off hand from its book item only', () => {
    const shield = bookItem('s', 'Shield', SHIELD);
    expect(wornGear(book([['off-hand', shield]]), 's')).toEqual({ equipped: true, shield: 2 });
    const dagger: BookItem = { id: 'd', name: 'Dagger', type: 'Simple Melee', rarity: null, tone: null, price: null, description: null, properties: [], at: 0 };
    expect(wornGear(book([['off-hand', dagger]]), 'x')).toEqual({ equipped: false, shield: null });
  });
});
