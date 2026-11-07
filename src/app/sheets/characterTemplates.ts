/**
 * Which notes are player character sheets: native statblocks of one of the two 5E character
 * templates, 2024 or 2014 rules. Read from the metadata cache, so menus can ask at once.
 */

import { TFile, type App } from 'obsidian';
import { frontmatterSource } from '../statblocks/notes/statblockSource';
import { FIVE_E_2014_CHARACTER_ID, FIVE_E_2024_CHARACTER_ID } from '../statblocks/presets/fiveECharacter';

export type CharacterTemplateId = typeof FIVE_E_2024_CHARACTER_ID | typeof FIVE_E_2014_CHARACTER_ID;

/** The rules each character template follows, as the GM picks them. */
export const EDITIONS: Readonly<Record<CharacterTemplateId, string>> = {
  [FIVE_E_2024_CHARACTER_ID]: 'D&D 5e (2024)',
  [FIVE_E_2014_CHARACTER_ID]: 'D&D 5e (2014)',
};

export const isCharacterTemplateId = (id: unknown): id is CharacterTemplateId => typeof id === 'string' && Object.hasOwn(EDITIONS, id);

/** The character template a note's frontmatter names; null for any other note. */
export function characterTemplateOf(frontmatter: Readonly<Record<string, unknown>> | null | undefined): CharacterTemplateId | null {
  const source = frontmatterSource(frontmatter);
  return source?.kind === 'atlas' && isCharacterTemplateId(source.templateId) ? source.templateId : null;
}

/** The Markdown note at a vault path. */
export function noteFile(app: App, path: string): TFile | null {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile && file.extension === 'md' ? file : null;
}

/** Whether the metadata cache reads the note at `path` as a character sheet. */
export function isCharacterNote(app: App, path: string | null | undefined): boolean {
  const file = path === null || path === undefined || path.trim() === '' ? null : noteFile(app, path);
  return file !== null && characterTemplateOf(app.metadataCache.getFileCache(file)?.frontmatter) !== null;
}
