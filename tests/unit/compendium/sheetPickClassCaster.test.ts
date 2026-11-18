import { describe, expect, it } from 'vitest';
import { pickResult } from '../../../src/app/compendium/sheetPickEdits';

describe('taking a class into a 5E sheet', () => {
  it('copies how the class casts from its spellcasting progression', () => {
    expect(pickResult('class', 'Paladin', { 'hit-die': 'd10', 'spellcasting-progression': 'half' }, {}, null)).toEqual([
      { op: 'set', path: ['classes'], base: undefined, next: [{ name: 'Paladin', level: 1, die: 'd10', caster: 'Demi' }] },
    ]);
    expect(pickResult('class', 'Occultiste', { 'hit-die': 'd8', 'spellcasting-progression': 'pact' }, {}, null)[0]).toMatchObject({ next: [{ caster: 'Pacte' }] });
  });

  it('leaves it out where the class note names none (a fighter, a compendium from before)', () => {
    expect(pickResult('class', 'Guerrier', { 'hit-die': 'd10' }, {}, null)[0]).toMatchObject({ next: [{ name: 'Guerrier', level: 1, die: 'd10' }] });
  });
});
