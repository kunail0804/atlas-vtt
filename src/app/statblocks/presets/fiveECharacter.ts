// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The 5E player character, 2024 and 2014 rules: the fork's character sheet as a built-in template, in
 * French. Both editions hold the same fields; only a few words differ, and the 2024 rules also work
 * out the hit point maximum and the spell slots from the classes, so a sheet switched from one to the
 * other keeps everything (`switchEdition`).
 */

import { D20_DICE_SET_ID } from '../../gameSystems/builtInDiceSets';
import type { BuiltInTemplate, StatBlock, TemplateBlock, TemplateLayout } from '../model/templateTypes';
import { ABILITY_NAMES, characterFields, SKILLS, type EditionWords } from './fiveECharacterFields';
import { spellSlotTable } from './fiveECharacterRules';
import { builtIn, hiddenParts } from './presetParts';

export const FIVE_E_2024_CHARACTER_ID = 'builtin:5e-2024-character';
export const FIVE_E_2014_CHARACTER_ID = 'builtin:5e-2014-character';

const modifier = (ability: number): string => `floor((stats.${ability} - 10) / 2)`;
const save = (ability: number): string => `${modifier(ability)} + proficiency * has(save_proficiencies, "${ABILITY_NAMES[ability]}")`;
/** A skill's bonus: its ability's modifier, plus the proficiency bonus once for a proficiency and twice for an expertise. */
const skill = (name: string, ability: number): string =>
  `${modifier(ability)} + proficiency * max(has(skill_proficiencies, "${name}"), 2 * has(skill_expertise, "${name}"))`;
/** The spellcasting ability's modifier, 0 without one. */
const CASTING = 'has(spell_ability, "Intelligence") * floor((stats.3 - 10) / 2) + has(spell_ability, "Sagesse") * floor((stats.4 - 10) / 2) + has(spell_ability, "Charisme") * floor((stats.5 - 10) / 2)';
const PERCEPTION = SKILLS.find(([id]) => id === 'perception') ?? ['perception', 'Perception', 4];

/** A number worked out from the sheet, rolled as a bonus when clicked. */
function rolled(id: string, field: string, label: string, formula: string): StatBlock {
  return { id, type: 'stat', field, label, look: 'run-in', pattern: `{=${formula}|signed}`, rollable: true };
}

function stacked(id: string, field: string, label: string, pattern?: string): StatBlock {
  return { id, type: 'stat', field, label, look: 'stacked', ...(pattern !== undefined && { pattern }) };
}

function section(id: string, heading: string, blocks: TemplateBlock[]): TemplateBlock {
  return { id, type: 'section', heading, blocks };
}

const mainTab = section('pcmain00', 'Principal', [
  {
    id: 'pcrow000', type: 'row', align: 'start', blocks: [
      stacked('pcac0000', 'ac', 'CA'),
      { ...stacked('pcinit00', 'initiative', 'Initiative', '{initiative|signed}'), rollable: true },
      stacked('pcspeed0', 'speed', 'Vitesse'),
      stacked('pcprof00', 'proficiency', 'Maîtrise', '{proficiency|signed}'),
      stacked('pchptmp0', 'hp_temp', 'PV temp.'),
      stacked('pcinsp00', 'inspiration', 'Inspiration'),
    ],
  },
  { id: 'pcstats0', type: 'scores', field: 'stats', orientation: 'table', perLine: 3, columns: [{ label: 'Mod', formula: 'floor((value - 10) / 2)', display: 'signed' }] },
  section('pcsaves0', 'Jets de sauvegarde', ABILITY_NAMES.map((name, ability) => rolled(`pcsave0${ability}`, 'save_proficiencies', name, save(ability)))),
  section('pcskills', 'Compétences', [
    ...SKILLS.map(([, name, ability], index) => rolled(`pcskl${String(index).padStart(3, '0')}`, 'skill_proficiencies', name, skill(name, ability))),
    { id: 'pcpassiv', type: 'stat', field: 'skill_proficiencies', label: 'Perception passive', look: 'run-in', pattern: `{=10 + ${skill(PERCEPTION[1], PERCEPTION[2])}}` },
    { id: 'pcexpert', type: 'tags', field: 'skill_expertise', label: 'Expertises', look: 'comma' },
  ]),
  section('pccombat', 'Combat', [
    { id: 'pchitdie', type: 'stat', field: 'hit_dice', label: 'Dés de vie', look: 'run-in', pattern: '{hit_dice}[ (dépensés : {hit_dice_spent})]' },
    { id: 'pcdeath0', type: 'line', fields: ['death_successes', 'death_failures'], pattern: 'Jets contre la mort : [{death_successes} réussite(s)][, {death_failures} échec(s)]' },
    { id: 'pcattack', type: 'entries', field: 'attacks', heading: 'Attaques', addLabel: 'Ajouter une attaque' },
  ]),
  section('pcknows0', 'Maîtrises', [
    { id: 'pclangs0', type: 'text', field: 'languages', heading: 'Langues' },
    { id: 'pcprofs0', type: 'text', field: 'proficiencies', heading: 'Autres maîtrises' },
  ]),
]);

const spellsTab = section('pcspell0', 'Sorts', [
  { id: 'pccastab', type: 'stat', field: 'spell_ability', label: 'Caractéristique', look: 'run-in' },
  {
    id: 'pcspelld', type: 'stat', field: 'spell_ability', label: 'DD des sorts', look: 'run-in', pattern: `{=8 + proficiency + ${CASTING}}`,
    showWhen: { field: 'spell_ability', is: 'present' },
  },
  { ...rolled('pcspella', 'spell_ability', 'Attaque de sort', `proficiency + ${CASTING}`), showWhen: { field: 'spell_ability', is: 'present' } },
  { id: 'pcslots0', type: 'counters', field: 'spell_slots', label: 'Emplacements' },
  { id: 'pcspells', type: 'entries', field: 'spell_list', heading: 'Sorts', addLabel: 'Ajouter un sort' },
]);

const traitsTab = section('pctraits', 'Traits', [{ id: 'pctrait0', type: 'entries', field: 'traits', heading: 'Traits', addLabel: 'Ajouter un trait' }]);

const STORY: readonly (readonly [string, string])[] = [
  ['personality', 'Traits de personnalité'], ['ideals', 'Idéaux'], ['bonds', 'Liens'], ['flaws', 'Défauts'], ['appearance', 'Apparence'], ['backstory', 'Histoire du personnage'],
];
const storyTab = section('pcstory0', 'Histoire', STORY.map(([field, heading], index) => ({ id: `pcstory${index + 1}`, type: 'text', field, heading })));

const LAYOUT: TemplateLayout = {
  maxColumns: 2,
  columnWidth: 22,
  blocks: [
    {
      id: 'pcident0', type: 'line', fields: ['class', 'subclass', 'species', 'background', 'alignment'],
      pattern: '[{class}][ ({subclass})][ · {species}][ · {background}][ · {alignment}]',
    },
    { id: 'pcclass0', type: 'entries', field: 'classes', heading: 'Classes', addLabel: 'Ajouter une classe' },
    { id: 'pctabs00', type: 'tabs', blocks: [mainTab, spellsTab, traitsTab, storyTab] },
  ],
};

function character(id: typeof FIVE_E_2024_CHARACTER_ID | typeof FIVE_E_2014_CHARACTER_ID, name: string, words: EditionWords): BuiltInTemplate {
  // Revision 2: the 2024 rules work out the hit point maximum and the spell slots; classes say how they cast.
  return builtIn(id, name, 2, {
    description: 'La fiche d\'un personnage joueur : ses caractéristiques, ses maîtrises, ses classes, ses sorts et son histoire.',
    suits: ['Personnage joueur'],
    diceSetId: D20_DICE_SET_ID,
    fields: characterFields(words),
    ...hiddenParts('type', 'description'),
    layout: LAYOUT,
    ...(words.worksOutClasses && { lookups: { spell_slots: spellSlotTable() } }),
    // Always worked out from other fields: a player's change would be written over at once.
    players: { proficiency: 'read', initiative: 'read' },
    sample: { name: 'Nom du personnage', level: 1, stats: [10, 10, 10, 10, 10, 10] },
  });
}

export const FIVE_E_2024_CHARACTER = character(FIVE_E_2024_CHARACTER_ID, 'Personnage 5E (règles 2024)', { species: 'Espèce', inspiration: 'Inspiration héroïque', worksOutClasses: true });
export const FIVE_E_2014_CHARACTER = character(FIVE_E_2014_CHARACTER_ID, 'Personnage 5E (règles 2014)', { species: 'Race', inspiration: 'Inspiration', worksOutClasses: false });
