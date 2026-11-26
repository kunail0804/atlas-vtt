import type { SharedRowPlace } from '../../../src/app/online/protocol/diceRow.ts';
import { setRoll } from '../../../src/app/gameSystems/diceSets.ts';
import type { DiceShelf } from '../../../src/app/react/components/dice/diceShelf.ts';
import type { DicePreset, DiceRowSlot } from '../../../src/app/types/dicePresetTypes.ts';

/**
 * The GM's dice row (`rules.diceRow`) as the page's tray holds it: the dice and the saved rolls the GM
 * pinned, in the GM's order. A designed roll keeps its dice's names and colours for the tray's face;
 * the GM's Atlas rolls it with its own rules when the page names it (`PlayerRoll.preset`), so its
 * critical rule here is none.
 */
export function shelfOfSharedRow(row: readonly SharedRowPlace[]): DiceShelf {
  const presets: DicePreset[] = [];
  const slots: DiceRowSlot[] = row.map((place): DiceRowSlot => {
    if ('die' in place) return { kind: 'die', sides: place.die };
    const { id, name, formula, look } = place.roll;
    presets.push({ id, name, formula, ...(look && { look: { dice: look.map((die) => ({ ...die })), crit: 'none' } }) });
    return { kind: 'preset', id };
  });
  return { presets, row: slots, ownRow: true };
}

/** What the page says a designed roll is, for the log until the GM's roll comes: its dice written out, then its bonus. */
export const designedFormula = (preset: DicePreset): string => (preset.look ? `${setRoll(preset.look.dice)}${preset.formula}` : preset.formula);
