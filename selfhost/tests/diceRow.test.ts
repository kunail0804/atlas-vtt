import { describe, expect, it } from 'vitest';
import { parseDiceRow } from '../../src/app/online/protocol/diceRow.ts';
import { designedFormula, shelfOfSharedRow } from '../player/src/diceRow.ts';

describe('the GM\'s dice row on the player page', () => {
  it('holds the GM\'s dice and pinned rolls in the GM\'s order, a designed roll with its dice', () => {
    const row = parseDiceRow([
      { die: 20 },
      { roll: { id: 'longsword', name: 'Longsword', formula: '1d8+3[slashing]' } },
      { roll: { id: 'hope', name: 'Duality', formula: '+2', look: [{ count: 1, sides: 12, name: 'Hope', colour: '#e0ac00' }, { count: 1, sides: 12, name: 'Fear' }] } },
    ]) ?? [];
    const shelf = shelfOfSharedRow(row);
    expect(shelf.ownRow).toBe(true);
    expect(shelf.row).toEqual([{ kind: 'die', sides: 20 }, { kind: 'preset', id: 'longsword' }, { kind: 'preset', id: 'hope' }]);
    expect(shelf.presets[0]).toEqual({ id: 'longsword', name: 'Longsword', formula: '1d8+3[slashing]' });
    expect(shelf.presets[1]?.look?.dice).toEqual([{ count: 1, sides: 12, name: 'Hope', colour: '#e0ac00' }, { count: 1, sides: 12, name: 'Fear' }]);
    expect(designedFormula(shelf.presets[1]!)).toBe('1d12+1d12+2');
    expect(designedFormula(shelf.presets[0]!)).toBe('1d8+3[slashing]');
  });
});
