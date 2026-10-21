import { entryProperties, FOLDERS, type BuildContext } from './context.ts';
import { noteText, type Note, type Property } from './notes.ts';
import { field, indexOf, isJson, list, nameOf, num, ordinal, prose, records, text, type Json } from './values.ts';

export function registerSpells(context: BuildContext): void {
  for (const spell of context.data('Spells')) context.registry.register(FOLDERS.spells, indexOf(spell), nameOf(spell));
}

/** "3rd-level evocation" (2014), "Level 3 Evocation" (2024), cantrips alike. */
function spellLine(context: BuildContext, level: number, school: string): string {
  if (context.edition === '2024') return level === 0 ? `${school} Cantrip` : `Level ${level} ${school}`;
  return level === 0 ? `${school} cantrip` : `${ordinal(level)}-level ${school.toLowerCase()}`;
}

/** `{ "3": "8d6", "4": "9d6" }` as a YAML map with string keys, or undefined. */
function damageBy(value: unknown): Record<string, Property> | undefined {
  if (!isJson(value)) return undefined;
  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

/** 2014 writes `damage` as a list of one, 2024 as an object. */
function damageOf(spell: Json): Json | undefined {
  const value = spell.damage;
  if (Array.isArray(value)) return records(value)[0];
  return isJson(value) ? value : undefined;
}

function higherLevel(spell: Json): string {
  const value = spell.higher_level;
  if (Array.isArray(value)) return value.filter((part) => typeof part === 'string').join('\n\n').trim();
  return text(value).trim();
}

export function spellNotes(context: BuildContext): Note[] {
  return context.data('Spells').map((spell) => {
    const level = num(spell.level) ?? 0;
    const school = nameOf(spell.school);
    const damage = damageOf(spell);
    const classes = list(spell.classes).map((entry) => context.registry.link(FOLDERS.classes, indexOf(entry), nameOf(entry)));
    const properties = {
      ...entryProperties(context, 'spell'),
      name: nameOf(spell),
      level,
      school,
      'casting-time': text(spell.casting_time),
      range: text(spell.range),
      components: list(spell.components).filter((entry): entry is string => typeof entry === 'string'),
      material: text(spell.material),
      duration: text(spell.duration),
      concentration: spell.concentration === true,
      ritual: spell.ritual === true,
      'attack-type': text(spell.attack_type),
      save: nameOf(field(spell.dc, 'dc_type')),
      'save-success': text(field(spell.dc, 'dc_success')),
      'damage-type': nameOf(field(damage, 'damage_type')),
      'damage-at-slot-level': damageBy(field(damage, 'damage_at_slot_level')),
      'damage-at-character-level': damageBy(field(damage, 'damage_at_character_level')),
      classes,
    };
    const upcast = higherLevel(spell);
    const heading = context.edition === '2024' ? 'Using a Higher-Level Spell Slot.' : 'At Higher Levels.';
    const body = [
      `*${spellLine(context, level, school)}${spell.ritual === true ? ' (ritual)' : ''}*`,
      prose(spell),
      upcast === '' ? '' : `***${heading}*** ${upcast}`,
    ].filter((part) => part !== '').join('\n\n');
    const path = context.registry.pathOf(FOLDERS.spells, indexOf(spell)) ?? '';
    return { path, text: noteText(properties, body) };
  });
}
