import { rulesOfPreset } from '../../src/app/gameSystems/systemRules';
import type { SystemPreset, SystemRules } from '../../src/app/types/systemPresetTypes';

/**
 * `rulesOfPreset` as a collection stores it, to compare with `SystemRules`: it names `diceSetId` even where the preset has
 * none (to clear the collection's), and a preset without a dice set leaves it out here.
 */
export function appliedRules(preset: SystemPreset): Omit<ReturnType<typeof rulesOfPreset>, 'diceSetId'> & Pick<SystemRules, 'diceSetId'> {
  const { diceSetId, ...applied } = rulesOfPreset(preset);
  return diceSetId === undefined ? applied : { ...applied, diceSetId };
}
