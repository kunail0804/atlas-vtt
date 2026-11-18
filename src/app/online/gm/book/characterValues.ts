import type { App } from 'obsidian';
import { PartySync } from '../../../campaigns/partyValues/PartySync';
import { withCurrent } from '../../../resources/resourceValues';
import { withMaxValue, type ResourceEdit } from './resourceEdit.ts';

/** An edit of the values the vault keeps of a character. */
export type CharacterResourceEdit = Extract<ResourceEdit, { readonly kind: 'character' }>;

/**
 * Writes a player's edit into the values the vault keeps of their character (`PartySync`, whatever
 * world is played), for a character whose token the shared scene does not hold: every open scene
 * that holds it shows the value, and no undo step is made. Returns the current value kept then,
 * clamped to the value's range, or null when it is refused: the values are not kept
 * (`isKeeping`), the token was placed from no player character, or no such value of it is kept
 * (a tracked number, or a gauge its template places, starts where its sheet offered it).
 * A maximum the player set is kept by hand (`maxByHand`), unless it is the note's
 * (`MaxRoute`), which the kept value then only follows.
 */
export function writeCharacterValue(app: App, edit: CharacterResourceEdit): { readonly current: number; readonly max: number } | null {
  const sync = PartySync.forApp(app);
  if (sync === undefined || !sync.isKeeping()) return null;
  const characterId = sync.characterOf(edit.placed);
  const value = characterId === null ? undefined : sync.value(characterId, edit.key) ?? edit.tracked;
  if (characterId === null || value === undefined) return null;
  const { max } = edit;
  const next = max === undefined ? withCurrent(value, edit.current) : withMaxValue(value, edit.current, max.value, max.fixed);
  const wasByHand = 'maxByHand' in value && value.maxByHand === true;
  const byHand = wasByHand || max?.route.kind === 'hand';
  if (next.current === value.current && next.max === value.max && byHand === wasByHand) return next;
  return sync.setValue(characterId, edit.key, { ...next, ...(byHand && { maxByHand: true as const }) }) ? next : null;
}
