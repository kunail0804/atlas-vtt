import { classNotes, registerClasses, subclassNotes } from './classes.ts';
import { dataReader, entryProperties, type BuildContext } from './context.ts';
import { equipmentNotes, magicItemNotes, registerEquipment } from './equipment.ts';
import { monsterNotes, registerMonsters } from './monsters.ts';
import { NoteRegistry, noteText, type Note } from './notes.ts';
import { registerRules, ruleNotes } from './rules.ts';
import { registerSpecies, speciesNotes } from './species.ts';
import { registerSpells, spellNotes } from './spells.ts';
import type { SourceDefinition } from './sources.ts';
import { sourceIdOf, sourceRootOf } from '../../src/app/compendium/sourceFormat.ts';

const PARTIAL = 'This source holds the part of the SRD that 5e-database transcribes, not the whole document: some rules, backgrounds and feats are missing.';

/** The note at the top of the source's folder: what it is, its licence and its attribution. */
function attributionNote(context: BuildContext, source: SourceDefinition, root: string): Note {
  const properties = { ...entryProperties(context, 'rule'), name: `${source.book.name} attribution`, license: source.license.name };
  const body = `${source.attribution}\n\nLicence: [${source.license.name}](${source.license.url})\n\n${PARTIAL}`;
  return { path: `${root}/Attribution.md`, text: noteText(properties, body) };
}

/**
 * Every note of one source, read from a checkout of 5e-bits/5e-database. All notes are registered
 * first so each can link to any other.
 */
export function buildSourceNotes(databaseDir: string, source: SourceDefinition): Note[] {
  const root = sourceRootOf(source.system, source.book);
  const context: BuildContext = {
    edition: source.edition,
    systemId: source.system.id,
    sourceId: sourceIdOf(source.system, source.book),
    registry: new NoteRegistry(root),
    data: dataReader(databaseDir, source.edition),
  };
  for (const register of [registerSpells, registerMonsters, registerClasses, registerSpecies, registerEquipment, registerRules]) register(context);
  const notes = [
    attributionNote(context, source, root),
    ...spellNotes(context),
    ...monsterNotes(context),
    ...classNotes(context),
    ...subclassNotes(context),
    ...speciesNotes(context),
    ...equipmentNotes(context),
    ...magicItemNotes(context),
    ...ruleNotes(context),
  ];
  const missing = notes.find((note) => note.path === '');
  if (missing) throw new Error(`A note of ${context.sourceId} has no registered path.`);
  return notes;
}
