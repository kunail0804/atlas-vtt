/** Backgrounds, feats, conditions and rule texts: notes of prose with a few properties. */

import { entryProperties, FOLDERS, type BuildContext } from './context.ts';
import { noteText, type Note } from './notes.ts';
import { cost, field, indexOf, list, nameOf, names, num, prose, records, text, type Json } from './values.ts';

export function registerRules(context: BuildContext): void {
  for (const entry of context.data('Backgrounds')) context.registry.register(FOLDERS.backgrounds, indexOf(entry), nameOf(entry));
  for (const entry of context.data('Feats')) context.registry.register(FOLDERS.feats, indexOf(entry), nameOf(entry));
  for (const entry of context.data('Conditions')) context.registry.register(FOLDERS.conditions, indexOf(entry), nameOf(entry));
  for (const entry of context.data('Rule-Sections')) context.registry.register(FOLDERS.rules, indexOf(entry), nameOf(entry));
  context.registry.register(FOLDERS.rules, 'weapon-properties', 'Weapon Properties');
  if (context.data('Weapon-Mastery-Properties').length > 0) context.registry.register(FOLDERS.rules, 'weapon-mastery', 'Weapon Mastery Properties');
}

function bulleted(title: string, lines: readonly string[]): string {
  return lines.length === 0 ? '' : `**${title}**\n\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

function backgroundNote(context: BuildContext, entry: Json): Note {
  const feature = field(entry, 'feature');
  const feat = field(entry, 'feat');
  const proficiencies = [...names(entry.starting_proficiencies), ...names(entry.proficiencies)];
  const properties = {
    ...entryProperties(context, 'background'),
    name: nameOf(entry),
    'ability-scores': names(entry.ability_scores),
    feat: feat === undefined ? '' : context.registry.link(FOLDERS.feats, indexOf(feat), nameOf(feat)),
    proficiencies,
  };
  const equipment = [
    ...records(entry.starting_equipment).map((item) => `${num(item.quantity) ?? 1} × ${nameOf(item.equipment)}`),
    ...records(entry.starting_equipment_options).map((option) => text(option.desc)),
    ...records(entry.equipment_options).map((option) => text(option.desc)),
  ].filter((line) => line !== '');
  const gold = cost(entry.starting_gold);
  const personality = (key: string, title: string): string =>
    bulleted(title, list(field(field(entry[key], 'from'), 'options')).map((option) => text(field(option, 'string')) || text(field(option, 'desc'))).filter((line) => line !== ''));
  const body = [
    feature === undefined ? '' : `## Feature: ${nameOf(feature)}\n\n${prose({ desc: field(feature, 'desc') })}`,
    bulleted('Equipment', gold === '' ? equipment : [...equipment, gold]),
    personality('personality_traits', 'Personality Traits'),
    personality('ideals', 'Ideals'),
    personality('bonds', 'Bonds'),
    personality('flaws', 'Flaws'),
  ].filter((part) => part !== '').join('\n\n');
  return { path: context.registry.pathOf(FOLDERS.backgrounds, indexOf(entry)) ?? '', text: noteText(properties, body) };
}

function featNote(context: BuildContext, entry: Json): Note {
  const prerequisites = records(entry.prerequisites)
    .map((requirement) => `${nameOf(requirement.ability_score)} ${num(requirement.minimum_score) ?? ''}`.trim())
    .filter((line) => line !== '');
  const properties = {
    ...entryProperties(context, 'feat'),
    name: nameOf(entry),
    'feat-type': text(entry.type),
    prerequisites: prerequisites.join(', ') || text(entry.prerequisite),
  };
  return { path: context.registry.pathOf(FOLDERS.feats, indexOf(entry)) ?? '', text: noteText(properties, prose(entry)) };
}

function conditionNote(context: BuildContext, entry: Json): Note {
  const properties = { ...entryProperties(context, 'condition'), name: nameOf(entry) };
  return { path: context.registry.pathOf(FOLDERS.conditions, indexOf(entry)) ?? '', text: noteText(properties, prose(entry)) };
}

/** A rule section's text without the heading it opens with, which repeats the note's name. */
function ruleSectionNote(context: BuildContext, entry: Json, chapter: string): Note {
  const body = prose(entry).replace(/^#+ [^\n]*\n+/, '');
  const properties = { ...entryProperties(context, 'rule'), name: nameOf(entry), chapter };
  return { path: context.registry.pathOf(FOLDERS.rules, indexOf(entry)) ?? '', text: noteText(properties, body) };
}

/** Every entry of a small rules file as one note: weapon properties, weapon mastery. */
function glossaryNote(context: BuildContext, index: string, title: string, file: string): Note {
  const body = context.data(file).map((entry) => `## ${nameOf(entry)}\n\n${prose(entry)}`).join('\n\n');
  const properties = { ...entryProperties(context, 'rule'), name: title };
  return { path: context.registry.pathOf(FOLDERS.rules, index) ?? '', text: noteText(properties, body) };
}

export function ruleNotes(context: BuildContext): Note[] {
  const chapterOf = new Map<string, string>();
  for (const chapter of context.data('Rules')) {
    for (const section of list(chapter.subsections)) chapterOf.set(indexOf(section), nameOf(chapter));
  }
  const notes = [
    ...context.data('Backgrounds').map((entry) => backgroundNote(context, entry)),
    ...context.data('Feats').map((entry) => featNote(context, entry)),
    ...context.data('Conditions').map((entry) => conditionNote(context, entry)),
    ...context.data('Rule-Sections').map((entry) => ruleSectionNote(context, entry, chapterOf.get(indexOf(entry)) ?? '')),
    glossaryNote(context, 'weapon-properties', 'Weapon Properties', 'Weapon-Properties'),
  ];
  if (context.data('Weapon-Mastery-Properties').length > 0) notes.push(glossaryNote(context, 'weapon-mastery', 'Weapon Mastery Properties', 'Weapon-Mastery-Properties'));
  return notes;
}
