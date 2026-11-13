/**
 * The worlds' characters files (`charactersFile.ts`) merged into the table's one
 * (`tableCharactersFile.ts`). The result is a function of the files alone, so two devices that migrate
 * at once write the same file: a character several worlds keep values of has, whole, the values of
 * the world played last (`lastPlayed`, then the world's id).
 */

import { isRecord } from '../campaignValues';
import { byRecency, type WorldFile } from '../tableFileLayout';
import type { StoredCharacters } from './charactersFile';
import { emptyTableCharacters } from './tableCharactersFile';

/** The table's characters file made from the worlds' files; null where no world keeps a character's values. */
export function mergeWorldCharacters(worlds: readonly WorldFile<StoredCharacters>[]): StoredCharacters | null {
  const characters = new Map<string, unknown>();
  for (const { stored } of byRecency(worlds)) {
    for (const [characterId, entry] of Object.entries(isRecord(stored.characters) ? stored.characters : {})) {
      if (characterId !== '' && isRecord(entry) && !characters.has(characterId)) characters.set(characterId, entry);
    }
  }
  // Built from entries, so a key such as `__proto__` is a key like any other.
  return characters.size === 0 ? null : { ...emptyTableCharacters(), characters: Object.fromEntries(characters) };
}
