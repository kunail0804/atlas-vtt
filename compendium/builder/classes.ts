/**
 * Classes and subclasses: each class note carries its proficiencies, its level table (proficiency
 * bonus, features, class-specific columns and spell slots), every class feature in full, links to
 * its subclasses and its spell list; each subclass note its features by level.
 */

import { entryProperties, FOLDERS, type BuildContext } from './context.ts';
import { noteText, table, type Note } from './notes.ts';
import { field, indexOf, isJson, list, nameOf, names, num, ordinal, prose, records, text, type Json } from './values.ts';

interface Feature {
  name: string;
  level: number;
  text: string;
}

export function registerClasses(context: BuildContext): void {
  for (const entry of context.data('Classes')) context.registry.register(FOLDERS.classes, indexOf(entry), nameOf(entry));
  for (const entry of context.data('Subclasses')) context.registry.register(FOLDERS.subclasses, indexOf(entry), nameOf(entry));
}

/** A feature's level: a number in 2014, a reference to `<class>-<level>` in 2024. */
function featureLevel(value: unknown): number {
  const direct = num(value);
  if (direct !== undefined) return direct;
  const match = /-(\d+)$/.exec(indexOf(value));
  return match?.[1] === undefined ? 0 : Number(match[1]);
}

/** The class's own features (no subclass), or the subclass's, in level order then name order. */
function featuresOf(context: BuildContext, classIndex: string, subclassIndex: string | null): Feature[] {
  const features = context.data('Features').filter((feature) => indexOf(feature.class) === classIndex
    && (subclassIndex === null ? feature.subclass === undefined : indexOf(feature.subclass) === subclassIndex)
    // A feature with a parent is one option of another feature (a Fighting Style, say), listed in its parent's text.
    && feature.parent === undefined);
  return features
    .map((feature) => ({ name: nameOf(feature), level: featureLevel(feature.level), text: withOptions(context, feature) }))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'en'));
}

/** A feature's text followed by its options, the features that name it as their parent. */
function withOptions(context: BuildContext, feature: Json): string {
  const options = context.data('Features').filter((option) => indexOf(option.parent) === indexOf(feature));
  return [prose(feature), ...options.map((option) => `**${nameOf(option)}.** ${prose(option)}`)].join('\n\n');
}

function featureSections(features: readonly Feature[]): string {
  return features.map((feature) => `### ${feature.name}\n*Level ${feature.level}*\n\n${feature.text}`).join('\n\n');
}

/** "Class specific" columns such as `rage_count`, as headings: "Rage Count". */
function columnHeading(key: string): string {
  return key.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function cellText(key: string, value: unknown): string {
  if (typeof value === 'number' && key.endsWith('_die')) return `d${value}`;
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  if (isJson(value)) {
    // Dice columns such as Martial Arts: `{ dice_count: 1, dice_value: 6 }`.
    const count = num(value.dice_count);
    const sides = num(value.dice_value);
    if (count !== undefined && sides !== undefined) return `${count}d${sides}`;
    return Object.values(value).filter((part) => typeof part === 'number' || typeof part === 'string').join('/');
  }
  return '';
}

/** The class table: one row per level, a column only where some level has a value. */
function levelTable(context: BuildContext, classIndex: string): string {
  const levels = context.data('Levels')
    .filter((level) => indexOf(level.class) === classIndex && level.subclass === undefined)
    .sort((a, b) => (num(a.level) ?? 0) - (num(b.level) ?? 0));
  if (levels.length === 0) return '';
  // A column of lists (Sorcery Points' slot costs) is a separate table in the book, not a column.
  const specificKeys = [...new Set(levels.flatMap((level) => (isJson(level.class_specific) ? Object.keys(level.class_specific) : [])))]
    .filter((key) => levels.some((level) => cellText(key, field(level.class_specific, key)) !== ''));
  const spellKeys = [...new Set(levels.flatMap((level) => (isJson(level.spellcasting) ? Object.keys(level.spellcasting) : [])))]
    .filter((key) => levels.some((level) => (num(field(level.spellcasting, key)) ?? 0) > 0));
  const spellHeading = (key: string): string => {
    const slot = /^spell_slots_level_(\d)$/.exec(key);
    return slot?.[1] === undefined ? columnHeading(key) : ordinal(Number(slot[1]));
  };
  const header = ['Level', 'Proficiency Bonus', 'Features', ...specificKeys.map(columnHeading), ...spellKeys.map(spellHeading)];
  const rows = levels.map((level) => [
    String(num(level.level) ?? ''),
    num(level.prof_bonus) === undefined ? '' : `+${num(level.prof_bonus)}`,
    names(level.features).join(', '),
    ...specificKeys.map((key) => cellText(key, field(level.class_specific, key))),
    ...spellKeys.map((key) => {
      const value = num(field(level.spellcasting, key)) ?? 0;
      return value === 0 ? '—' : String(value);
    }),
  ]);
  return table(header, rows);
}

/** Option lists ("Choose two from Arcana, …") as the SRD words them. */
function choices(value: unknown): string[] {
  return records(value).map((choice) => text(choice.desc)).filter((line) => line !== '');
}

function spellList(context: BuildContext, classIndex: string): string {
  const byLevel = new Map<number, string[]>();
  for (const spell of context.data('Spells')) {
    if (!list(spell.classes).some((entry) => indexOf(entry) === classIndex)) continue;
    const level = num(spell.level) ?? 0;
    byLevel.set(level, [...(byLevel.get(level) ?? []), context.registry.link(FOLDERS.spells, indexOf(spell), nameOf(spell))]);
  }
  return [...byLevel.keys()].sort((a, b) => a - b)
    .map((level) => `**${level === 0 ? 'Cantrips' : `Level ${level}`}:** ${(byLevel.get(level) ?? []).join(', ')}`)
    .join('\n\n');
}

function multiclassing(entry: Json): string {
  const prerequisites = records(field(entry.multi_classing, 'prerequisites'))
    .map((requirement) => `${nameOf(requirement.ability_score)} ${num(requirement.minimum_score) ?? ''}`.trim());
  return prerequisites.join(', ');
}

export function classNotes(context: BuildContext): Note[] {
  return context.data('Classes').map((entry) => {
    const index = indexOf(entry);
    const spellcasting = isJson(entry.spellcasting) ? entry.spellcasting : undefined;
    const subclasses = list(entry.subclasses).map((subclass) => context.registry.link(FOLDERS.subclasses, indexOf(subclass), nameOf(subclass)));
    const properties = {
      ...entryProperties(context, 'class'),
      name: nameOf(entry),
      'hit-die': num(entry.hit_die) === undefined ? '' : `d${num(entry.hit_die)}`,
      'primary-ability': text(field(entry.primary_ability, 'desc')),
      'saving-throws': names(entry.saving_throws),
      proficiencies: names(entry.proficiencies).filter((name) => !name.startsWith('Saving Throw')),
      'skill-choices': choices(entry.proficiency_choices),
      'spellcasting-ability': nameOf(field(spellcasting, 'spellcasting_ability')),
      'multiclass-prerequisites': multiclassing(entry),
      subclasses,
    };
    const equipment = [
      ...records(entry.starting_equipment).map((item) => `${num(item.quantity) ?? 1} × ${nameOf(item.equipment)}`),
      ...choices(entry.starting_equipment_options),
    ];
    const spellcastingInfo = records(field(spellcasting, 'info')).map((part) => `### ${nameOf(part)}\n\n${prose(part)}`).join('\n\n');
    const spells = spellList(context, index);
    const body = [
      `## The ${nameOf(entry)} table\n\n${levelTable(context, index)}`,
      equipment.length === 0 ? '' : `## Starting equipment\n\n${equipment.map((line) => `- ${line}`).join('\n')}`,
      `## Class features\n\n${featureSections(featuresOf(context, index, null))}`,
      spellcastingInfo === '' ? '' : `## Spellcasting\n\n${spellcastingInfo}`,
      subclasses.length === 0 ? '' : `## Subclasses\n\n${subclasses.map((link) => `- ${link}`).join('\n')}`,
      spells === '' ? '' : `## Spell list\n\n${spells}`,
    ].filter((part) => part !== '').join('\n\n');
    return { path: context.registry.pathOf(FOLDERS.classes, index) ?? '', text: noteText(properties, body) };
  });
}

/** 2024 subclasses list their features inline; 2014 ones keep them in the features file. */
function subclassFeatures(context: BuildContext, entry: Json): Feature[] {
  const inline = records(entry.features);
  if (inline.length > 0) {
    return inline.map((feature) => ({ name: nameOf(feature), level: num(feature.level) ?? 0, text: prose(feature) }))
      .sort((a, b) => a.level - b.level);
  }
  return featuresOf(context, indexOf(entry.class), indexOf(entry));
}

export function subclassNotes(context: BuildContext): Note[] {
  return context.data('Subclasses').map((entry) => {
    const properties = {
      ...entryProperties(context, 'subclass'),
      name: nameOf(entry),
      class: context.registry.link(FOLDERS.classes, indexOf(entry.class), nameOf(entry.class)),
      flavor: text(entry.subclass_flavor),
      summary: text(entry.summary),
    };
    const body = [prose(entry), `## Features\n\n${featureSections(subclassFeatures(context, entry))}`].filter((part) => part !== '').join('\n\n');
    return { path: context.registry.pathOf(FOLDERS.subclasses, indexOf(entry)) ?? '', text: noteText(properties, body) };
  });
}
