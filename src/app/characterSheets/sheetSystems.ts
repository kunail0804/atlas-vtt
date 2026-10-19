import { DND5E_2014, DND5E_2024 } from './dnd5e2024.ts';
import type { SheetSystem } from './sheetSystem.ts';

/** Every system a character sheet can be of; a new system is one more entry. */
export const SHEET_SYSTEMS: readonly SheetSystem[] = [DND5E_2024, DND5E_2014];

export function sheetSystem(id: unknown): SheetSystem | null {
  return SHEET_SYSTEMS.find((system) => system.id === id) ?? null;
}
