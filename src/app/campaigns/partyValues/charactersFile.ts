/**
 * What the table's characters file holds (`tableCharactersFile.ts`) and the functions that read and
 * change it: the values the table keeps of its player characters. `{ format, characters: { <library
 * token id>: { resources: { <key>: { current, max, maxByHand? } } } } }`; fields Atlas does not know
 * are kept.
 */

import type { StoredRecord } from '../../services/recordFiles/recordLayout';
import { isRecord } from '../campaignValues';
import { isOfWritableFormat } from '../tableFileLayout';
import { partyKey, readPartyKey, readPartyValue, type PartyValue, type PartyValues } from './partyKeys';

export const CHARACTERS_FILE = 'characters.json';
/** The format this Atlas writes; a file of a later one is read and never written. */
export const CHARACTERS_FORMAT = 1;

/** What one file holds at most: characters, values per character, characters in a key or id. */
const MAX_CHARACTERS = 500;
const MAX_VALUES = 200;
const MAX_KEY = 200;

/** The table's characters file as stored. */
export type StoredCharacters = StoredRecord;

/** The values to write: by party key, a value or undefined to remove it. */
export type PartyChanges = ReadonlyMap<string, PartyValue | undefined>;

/** Whether this Atlas may write the file: one of a later format is only read. */
export const isWritable = (stored: StoredCharacters): boolean => isOfWritableFormat(stored, CHARACTERS_FORMAT);

/** The values a characters file holds, as party values; what cannot be read is left out. */
export function partyValuesOf(stored: StoredCharacters): PartyValues {
  const values: Record<string, PartyValue> = {};
  const characters = isRecord(stored.characters) ? Object.entries(stored.characters).slice(0, MAX_CHARACTERS) : [];
  for (const [characterId, entry] of characters) {
    if (characterId === '' || characterId.length > MAX_KEY || !isRecord(entry) || !isRecord(entry.resources)) continue;
    for (const [key, raw] of Object.entries(entry.resources).slice(0, MAX_VALUES)) {
      const value = key !== '' && key.length <= MAX_KEY ? readPartyValue(raw) : null;
      if (value) values[partyKey(characterId, key)] = value;
    }
  }
  return values;
}

/**
 * The file as stored with `changes` made value by value: every other value and field stays, so another device's values survive; a file of a later format is
 * returned as it is.
 */
export function withPartyChanges(stored: StoredCharacters, changes: PartyChanges): StoredCharacters {
  if (!isWritable(stored)) return stored;
  const characters: Record<string, unknown> = isRecord(stored.characters) ? { ...stored.characters } : {};
  for (const [key, value] of changes) {
    const parts = readPartyKey(key);
    if (parts === null) continue;
    const entry = isRecord(characters[parts.characterId]) ? characters[parts.characterId] as Record<string, unknown> : {};
    const resources: Record<string, unknown> = isRecord(entry.resources) ? { ...entry.resources } : {};
    if (value) resources[parts.resourceKey] = { current: value.current, max: value.max, ...(value.maxByHand && { maxByHand: true }) };
    else delete resources[parts.resourceKey];
    characters[parts.characterId] = { ...entry, resources };
  }
  return { ...stored, characters };
}
