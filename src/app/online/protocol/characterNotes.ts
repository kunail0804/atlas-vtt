import { parseFoundNote, type FoundNote } from './logShown.ts';
import { isRecord } from './shape.ts';

/** The frontmatter key of the notes the GM links to a character for its player, as `[[links]]`. */
export const PLAYER_NOTES_KEY = 'atlas-player-notes';
/** The most notes a character's player is given. */
export const MAX_PLAYER_NOTES = 30;

/**
 * The notes the GM linked to a player's own character (`atlas-player-notes` of its statblock note),
 * read as found notes are. Sent to that player alone, whole, whenever one of them or the character
 * changes; none where their character has none.
 */
export interface CharacterNotesMessage {
  readonly t: 'character-notes';
  readonly notes: readonly FoundNote[];
}

export function parseCharacterNotesMessage(value: Record<string, unknown>): CharacterNotesMessage | null {
  if (!Array.isArray(value.notes) || value.notes.length > MAX_PLAYER_NOTES) return null;
  const notes = value.notes.map((note: unknown) => (isRecord(note) ? parseFoundNote(note) : null));
  return notes.every((note): note is FoundNote => note !== null) ? { t: 'character-notes', notes } : null;
}
