import type { App } from 'obsidian';
import { NoteFieldWriter } from '../statblocks/notes/NoteFieldWriter';
import { TEMPLATE_KEY } from '../statblocks/notes/statblockSource';
import { toFieldValue } from '../statblocks/values/fieldValueOf';
import { EDITIONS, isCharacterTemplateId, type CharacterTemplateId } from './characterTemplates';

/**
 * Puts a character sheet under the other rule set: its note names the other character template. Both
 * hold the same fields, so every value is kept. Nothing happens to a note that is no character sheet.
 */
export async function switchEdition(app: App, path: string, edition: CharacterTemplateId): Promise<boolean> {
  const outcome = await NoteFieldWriter.forApp(app).patchNow(path, (note) => {
    const current = note?.[TEMPLATE_KEY];
    if (!isCharacterTemplateId(current) || current === edition || !Object.hasOwn(EDITIONS, edition)) return [];
    return [{ op: 'set', path: [TEMPLATE_KEY], base: toFieldValue(current), next: edition }];
  });
  return outcome.applied.length > 0;
}
