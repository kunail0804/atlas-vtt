// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The fields of a 5E player character (2014 and 2024 rules alike), with French labels: the fork's own
 * character sheet, on the statblock engine. Keys are the ones formulas name (letters, digits, `_`).
 */

import type { TemplateField } from '../model/templateTypes';
import { nameField, portraitField } from './presetParts';

/** The six abilities: the label of their column in `stats`, the key a statblock written by name uses, and their name in picks. */
export const ABILITY_NAMES = ['Force', 'Dextérité', 'Constitution', 'Intelligence', 'Sagesse', 'Charisme'] as const;
const ABILITY_COLUMNS = ['FOR', 'DEX', 'CON', 'INT', 'SAG', 'CHA'];
const ABILITY_KEYS = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];

/** The skills, in the sheet's order: the id older sheets stored, the name a pick holds, and the ability (its `stats` column). */
export const SKILLS: readonly (readonly [id: string, name: string, ability: number])[] = [
  ['acrobatics', 'Acrobaties', 1], ['animal-handling', 'Dressage', 4], ['arcana', 'Arcanes', 3], ['athletics', 'Athlétisme', 0],
  ['deception', 'Tromperie', 5], ['history', 'Histoire', 3], ['insight', 'Intuition', 4], ['intimidation', 'Intimidation', 5],
  ['investigation', 'Investigation', 3], ['medicine', 'Médecine', 4], ['nature', 'Nature', 3], ['perception', 'Perception', 4],
  ['performance', 'Représentation', 5], ['persuasion', 'Persuasion', 5], ['religion', 'Religion', 3], ['sleight-of-hand', 'Escamotage', 1],
  ['stealth', 'Discrétion', 1], ['survival', 'Survie', 4],
];

/** The alignments, in French; the field stays open, so a sheet keeps one written otherwise. */
export const ALIGNMENTS = [
  'Loyal Bon', 'Neutre Bon', 'Chaotique Bon', 'Loyal Neutre', 'Neutre', 'Chaotique Neutre', 'Loyal Mauvais', 'Neutre Mauvais', 'Chaotique Mauvais', 'Sans alignement',
];

/** The abilities a spellcaster casts with. */
export const SPELL_ABILITIES = ['Intelligence', 'Sagesse', 'Charisme'] as const;

/** A field the template works out and writes into the note. */
const derived = (field: TemplateField, pattern: string): TemplateField => ({ ...field, derive: pattern });

const choiceOf = (key: string, label: string, options: readonly string[], several = false): TemplateField => ({
  key, label, type: 'choice', options: [...options], ...(several && { several: true }),
});

const number = (key: string, label: string): TemplateField => ({ key, label, type: 'number' });
const markdown = (key: string, label: string): TemplateField => ({ key, label, type: 'markdown' });

/** The words the two rule sets name differently. */
export interface EditionWords {
  readonly species: string;
  readonly inspiration: string;
}

/**
 * Every field, in the order the statblock pane steps through them. `class`, `level` and `hit_dice` are
 * worked out from the classes where the sheet lists some, `proficiency` from the level and `initiative`
 * from Dexterity and its bonus: written into the note, so Atlas' initiative and anything reading the
 * note find them.
 */
export function characterFields(words: EditionWords): TemplateField[] {
  const skillNames = SKILLS.map(([, name]) => name);
  return [
    nameField(),
    portraitField(),
    {
      key: 'classes', label: 'Classes', type: 'entries', entry: {
        extras: [{ key: 'level', label: 'Niveau', type: 'number' }, { key: 'die', label: 'Dé de vie', type: 'choice', options: ['d6', 'd8', 'd10', 'd12'] }],
      },
    },
    derived({ key: 'class', label: 'Classe', type: 'text' }, '{classes|pluck:name|join: / }'),
    { key: 'subclass', label: 'Sous-classe', type: 'text' },
    derived({ key: 'level', label: 'Niveau', type: 'number', meaning: 'rating' }, '{classes|pluck:level|sum}'),
    { key: 'species', label: words.species, type: 'text' },
    { key: 'background', label: 'Historique', type: 'text' },
    { ...choiceOf('alignment', 'Alignement', ALIGNMENTS), open: true },
    number('xp', 'XP'),
    {
      key: 'stats', label: 'Caractéristiques', type: 'scores', addRows: false, addColumns: false,
      slots: ABILITY_COLUMNS, slotKeys: ABILITY_KEYS, rows: [[10, 10, 10, 10, 10, 10]],
    },
    derived(number('proficiency', 'Bonus de maîtrise'), '{=ceil(min(20, max(1, level)) / 4) + 1}'),
    choiceOf('save_proficiencies', 'Maîtrises de sauvegarde', ABILITY_NAMES, true),
    choiceOf('skill_proficiencies', 'Compétences maîtrisées', skillNames, true),
    choiceOf('skill_expertise', 'Expertises', skillNames, true),
    choiceOf('inspiration', words.inspiration, ['Oui']),
    { ...number('ac', 'CA'), meaning: 'armor' },
    { ...number('hp', 'PV max'), meaning: 'hit-points' },
    number('hp_temp', 'PV temporaires'),
    { key: 'speed', label: 'Vitesse', type: 'text' },
    number('initiative_bonus', 'Bonus d\'initiative'),
    derived({ ...number('initiative', 'Initiative'), meaning: 'initiative' }, '{=floor((stats.1 - 10) / 2) + initiative_bonus}'),
    derived({ key: 'hit_dice', label: 'Dés de vie', type: 'dice' }, '{classes|pool:level,die}'),
    number('hit_dice_spent', 'Dés de vie dépensés'),
    number('death_successes', 'Réussites contre la mort'),
    number('death_failures', 'Échecs contre la mort'),
    markdown('languages', 'Langues'),
    markdown('proficiencies', 'Autres maîtrises'),
    {
      key: 'attacks', label: 'Attaques', type: 'entries', entry: {
        extras: [{ key: 'bonus', label: 'Bonus', type: 'text' }, { key: 'damage', label: 'Dégâts', type: 'dice' }],
      },
    },
    choiceOf('spell_ability', 'Caractéristique d\'incantation', SPELL_ABILITIES),
    { key: 'spell_slots', label: 'Emplacements de sorts', type: 'counters' },
    {
      key: 'spell_list', label: 'Sorts', type: 'entries', entry: {
        extras: [{ key: 'level', label: 'Niv.', type: 'number' }, { key: 'prepared', label: 'Préparé', type: 'choice', options: ['Préparé'] }],
      },
    },
    { key: 'traits', label: 'Traits', type: 'entries' },
    markdown('personality', 'Traits de personnalité'),
    markdown('ideals', 'Idéaux'),
    markdown('bonds', 'Liens'),
    markdown('flaws', 'Défauts'),
    markdown('appearance', 'Apparence'),
    markdown('backstory', 'Histoire du personnage'),
  ];
}
