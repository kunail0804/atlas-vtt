/**
 * Species (2014: races) with their traits written out, and their subraces or lineages as sections
 * of the same note: a lineage is never chosen without its species.
 */

import { entryProperties, FOLDERS, type BuildContext } from './context.ts';
import { noteText, type Note } from './notes.ts';
import { indexOf, list, nameOf, names, num, prose, records, text, type Json } from './values.ts';

const speciesFile = (context: BuildContext): string => (context.edition === '2014' ? 'Races' : 'Species');
const subspeciesFile = (context: BuildContext): string => (context.edition === '2014' ? 'Subraces' : 'Subspecies');

export function registerSpecies(context: BuildContext): void {
  for (const entry of context.data(speciesFile(context))) context.registry.register(FOLDERS.species, indexOf(entry), nameOf(entry));
}

function traitText(context: BuildContext, reference: unknown): string {
  const trait = context.data('Traits').find((candidate) => indexOf(candidate) === indexOf(reference));
  return `***${nameOf(reference)}.*** ${trait ? prose(trait) : ''}`.trim();
}

/** "DEX +2, CON +1". */
function abilityBonuses(value: unknown): string {
  return records(value).map((bonus) => `${nameOf(bonus.ability_score)} +${num(bonus.bonus) ?? 0}`).join(', ');
}

function subspeciesSection(context: BuildContext, entry: Json): string {
  const traits = [...list(entry.racial_traits), ...list(entry.traits)].map((reference) => traitText(context, reference));
  const bonuses = abilityBonuses(entry.ability_bonuses);
  return [
    `### ${nameOf(entry)}`,
    prose(entry),
    bonuses === '' ? '' : `**Ability Score Increase:** ${bonuses}`,
    ...traits,
  ].filter((part) => part !== '').join('\n\n');
}

export function speciesNotes(context: BuildContext): Note[] {
  return context.data(speciesFile(context)).map((entry) => {
    const index = indexOf(entry);
    const subspecies = context.data(subspeciesFile(context))
      .filter((candidate) => indexOf(candidate.race) === index || indexOf(candidate.species) === index);
    const properties = {
      ...entryProperties(context, 'species'),
      name: nameOf(entry),
      'creature-type': text(entry.type),
      size: text(entry.size),
      speed: num(entry.speed),
      'ability-bonuses': abilityBonuses(entry.ability_bonuses),
      languages: names(entry.languages),
      traits: names(entry.traits),
      [context.edition === '2014' ? 'subraces' : 'lineages']: subspecies.map(nameOf),
    };
    const body = [
      ...[entry.age, entry.alignment, entry.size_description, entry.language_desc]
        .map((part, position) => (text(part) === '' ? '' : `**${['Age', 'Alignment', 'Size', 'Languages'][position]}.** ${text(part)}`)),
      list(entry.traits).length === 0 ? '' : `## Traits\n\n${list(entry.traits).map((reference) => traitText(context, reference)).join('\n\n')}`,
      subspecies.length === 0 ? '' : `## ${context.edition === '2014' ? 'Subraces' : 'Lineages'}\n\n${subspecies.map((sub) => subspeciesSection(context, sub)).join('\n\n')}`,
    ].filter((part) => part !== '').join('\n\n');
    return { path: context.registry.pathOf(FOLDERS.species, index) ?? '', text: noteText(properties, body) };
  });
}

