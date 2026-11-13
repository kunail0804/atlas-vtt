/**
 * `characters.json` directly in the worlds' folder (`tableFileLayout.ts`): the values the GM's table
 * keeps of its player characters, whatever world it plays. `{ format, characters: { <library token
 * id>: { resources: { <key>: { current, max, maxByHand? } } } } }`, the shape of a world's characters
 * file (`charactersFile.ts`) without its `campaignId`. Where the vault had none, the worlds' files
 * are carried into it (`charactersMigration.ts`).
 */

import type { RecordLayout } from '../../services/recordFiles/recordLayout';
import { TABLE_FILE_ID, tableFileLayout } from '../tableFileLayout';
import { CHARACTERS_FILE, CHARACTERS_FORMAT, type StoredCharacters } from './charactersFile';

const FILE = tableFileLayout({ file: CHARACTERS_FILE, format: CHARACTERS_FORMAT, kind: 'table characters' });

export const TABLE_CHARACTERS_PATH = FILE.path;

export const TABLE_CHARACTERS_LAYOUT: RecordLayout<StoredCharacters> = FILE.layout;

/** An empty characters file of the table. */
export const emptyTableCharacters = (): StoredCharacters => ({ id: TABLE_FILE_ID, characters: {} });
