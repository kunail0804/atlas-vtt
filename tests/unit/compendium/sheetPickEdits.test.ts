import { describe, expect, it } from 'vitest';
import { DND5E_2024 } from '../../../src/app/characterSheets/dnd5e2024';
import { applySheetEdit, newSheet } from '../../../src/app/characterSheets/sheetNote';
import type { SheetValues } from '../../../src/app/characterSheets/sheetFields';
import { pickResult, gearKind, choiceDetail } from '../../../src/app/compendium/sheetPickEdits';
import type { PickKind } from '../../../src/app/characterSheets/sheetCompendium';

/** The sheet after taking an entry, every edit by the sheet's own rules. */
function take(values: SheetValues, kind: PickKind, name: string, frontmatter: Record<string, unknown>, body = ''): SheetValues {
  let next = values;
  for (const edit of pickResult(kind, name, frontmatter, body, next).edits) next = applySheetEdit(DND5E_2024, next, edit) ?? next;
  return next;
}

const MIRA: SheetValues = { ...newSheet(DND5E_2024, 'Mira'), stats: [10, 16, 12, 10, 14, 8] };

describe('taking a compendium entry into a 5e sheet', () => {
  it('multiclasses: each class once, the level and the hit dice following from them', () => {
    let values = take(MIRA, 'class', 'Fighter', { 'hit-die': 'd10' });
    values = take(values, 'class', 'Wizard', { 'hit-die': 'd6' });
    values = take(values, 'class', 'fighter', { 'hit-die': 'd10' });
    expect(values.classes).toEqual([{ name: 'Fighter', level: 1, die: 'd10' }, { name: 'Wizard', level: 1, die: 'd6' }]);
    expect([values.class, values.level, values['hit-dice']]).toEqual(['Fighter / Wizard', 2, '1d10 + 1d6']);
    // A class gains a level: the total and the dice follow.
    values = applySheetEdit(DND5E_2024, values, { op: 'row', key: 'classes', index: 0, row: { name: 'Fighter', level: 3, die: 'd10' } }) ?? values;
    expect([values.level, values['hit-dice']]).toEqual([4, '3d10 + 1d6']);
    // The last class taken out: the sheet keeps what it had.
    values = applySheetEdit(DND5E_2024, values, { op: 'row', key: 'classes', index: 1, row: null }) ?? values;
    values = applySheetEdit(DND5E_2024, values, { op: 'row', key: 'classes', index: 0, row: null }) ?? values;
    expect(values.classes).toEqual([]);
  });

  it('adds a weapon as an attack worked out from the character, and as an item worn in the main hand', () => {
    const rapier = { 'item-type': 'weapon', 'weapon-category': 'Martial Melee', damage: '1d8', 'damage-type': 'Piercing', properties: ['Finesse'], cost: '25 gp' };
    const result = pickResult('weapon', 'Rapier', rapier, 'A thin blade.', MIRA);
    // Finesse: Dexterity (+3) beats Strength (+0); proficiency +2.
    expect(result.edits).toEqual([{ op: 'row', key: 'attacks', index: 0, row: { name: 'Rapier', bonus: '+5', damage: '1d8+3 piercing', notes: 'Finesse' } }]);
    expect(result.gear?.slot).toBe('main-hand');
    expect(result.gear?.item).toMatchObject({ name: 'Rapier', type: 'Martial Melee', price: '25 gp', description: 'A thin blade.' });
    expect(gearKind(rapier)).toBe('weapon');
  });

  it('sets the armour class from an armour, Dexterity within its cap, and a shield on top', () => {
    const scale = { 'item-type': 'armor', 'armor-category': 'Medium', 'armor-class': 14, 'dex-bonus': true, 'max-dex-bonus': 2 };
    let values = take(MIRA, 'armor', 'Scale Mail', scale);
    expect(values.ac).toBe(16);
    values = take(values, 'armor', 'Shield', { 'item-type': 'shield', 'armor-category': 'Shield', 'armor-class': 2 });
    expect(values.ac).toBe(18);
    expect(pickResult('armor', 'Shield', { 'item-type': 'shield', 'armor-class': 2 }, '', values).gear?.slot).toBe('off-hand');
  });

  it('adds a spell to the list once, with its level and how it is cast', () => {
    const fireball = { level: 3, school: 'Evocation', 'casting-time': '1 action', range: '150 feet', duration: 'Instantaneous' };
    let values = take(MIRA, 'spell', 'Fireball', fireball);
    values = take(values, 'spell', 'Fireball', fireball);
    expect(values['spell-list']).toEqual([{ level: 3, name: 'Fireball', prepared: false, notes: '1 action · 150 feet · Instantaneous' }]);
    expect(choiceDetail('spell', fireball)).toBe('Level 3 · Evocation');
  });

  it('sets a species, a background or a subclass by name', () => {
    expect(take(MIRA, 'species', 'Elf', {}).species).toBe('Elf');
    expect(choiceDetail('subclass', { class: '[[Classes/Fighter|Fighter]]' })).toBe('Fighter');
  });
});
