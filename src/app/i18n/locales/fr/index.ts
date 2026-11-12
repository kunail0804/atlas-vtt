import type { Translation } from '../../types';
import { counter } from './counter';
import { recovery } from './recovery';
import { recoveryEditor } from './recoveryEditor';
import { rest } from './rest';
import { worldBackup } from './worldBackup';
import { statblock } from './statblock';
import { statblockEditor } from './statblockEditor';

/** French: the statblock panel only for now; every other key falls back to English. */
export const fr: Translation = {
  ...counter,
  ...recovery,
  ...recoveryEditor,
  ...rest,
  ...worldBackup,
  ...statblock,
  ...statblockEditor,
};
