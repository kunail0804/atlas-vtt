import type { Ability } from './dnd5e2024.ts';

/** The 2024 sheet's words, in one place for every language the sheet will speak. */
export const DND5E_LABELS = {
  abilities: { str: 'Force', dex: 'Dextérité', con: 'Constitution', int: 'Intelligence', wis: 'Sagesse', cha: 'Charisme' } satisfies Record<Ability, string>,
  short: { str: 'FOR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'SAG', cha: 'CHA' } satisfies Record<Ability, string>,
  skills: {
    acrobatics: 'Acrobaties', 'animal-handling': 'Dressage', arcana: 'Arcanes', athletics: 'Athlétisme', deception: 'Tromperie', history: 'Histoire',
    insight: 'Intuition', intimidation: 'Intimidation', investigation: 'Investigation', medicine: 'Médecine', nature: 'Nature', perception: 'Perception',
    performance: 'Représentation', persuasion: 'Persuasion', religion: 'Religion', 'sleight-of-hand': 'Escamotage', stealth: 'Discrétion', survival: 'Survie',
  } as Readonly<Record<string, string>>,
  tabs: { main: 'Principal', spells: 'Sorts', traits: 'Traits', story: 'Histoire', notes: 'Documents', book: 'Livre' },
  name: 'Nom du personnage', class: 'Classe', subclass: 'Sous-classe', level: 'Niveau', background: 'Historique',
  alignment: 'Alignement', xp: 'XP', proficiency: 'Bonus de maîtrise',
  savesTitle: 'Jets de sauvegarde', skillsTitle: 'Compétences', proficient: 'Maîtrise', expertise: 'Expertise', passive: 'Perception passive',
  ac: 'CA', initiative: 'Initiative', initiativeBonus: 'Bonus d\'initiative', speed: 'Vitesse',
  hpMax: 'PV max', hpCurrent: 'PV actuels', hpTemp: 'PV temporaires', hitDice: 'Dés de vie', hitDiceSpent: 'Dépensés',
  deathSaves: 'Jets contre la mort', successes: 'Réussites', failures: 'Échecs',
  attacks: 'Attaques', attackName: 'Nom', attackBonus: 'Bonus', damage: 'Dégâts', notes: 'Notes',
  languages: 'Langues', proficiencies: 'Autres maîtrises',
  spellAbility: 'Caractéristique d\'incantation', spellDc: 'DD des sorts', spellAttack: 'Attaque de sort', slots: 'Emplacements', slotsSpent: 'Utilisés',
  spellLevel: 'Niv.', spellName: 'Sort', prepared: 'Préparé', none: '—',
  traitName: 'Trait', traitDesc: 'Description',
  personality: 'Traits de personnalité', ideals: 'Idéaux', bonds: 'Liens', flaws: 'Défauts', appearance: 'Apparence', backstory: 'Histoire du personnage',
  add: 'Ajouter', remove: 'Retirer',
  check: (what: string): string => `Test de ${what}`,
  save: (what: string): string => `Sauvegarde de ${what}`,
} as const;

/** The words the two rule sets name differently. */
export const DND5E_EDITION_LABELS = {
  'dnd5e-2014': { species: 'Race', inspiration: 'Inspiration' },
  'dnd5e-2024': { species: 'Espèce', inspiration: 'Inspiration héroïque' },
} as const;
