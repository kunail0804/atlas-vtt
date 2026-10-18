import { DND5E_2024 } from './dnd5e2024.ts';
import type { SheetSystem } from './sheetSystem.ts';

/** Every system a character sheet can be of; a new system is one more entry. */
export const SHEET_SYSTEMS: readonly SheetSystem[] = [DND5E_2024];

export function sheetSystem(id: unknown): SheetSystem | null {
  return SHEET_SYSTEMS.find((system) => system.id === id) ?? null;
}
