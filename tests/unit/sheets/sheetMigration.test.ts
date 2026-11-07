import { describe, expect, it } from 'vitest';
import { migratedSheet } from '../../../src/app/sheets/sheetMigration';
import { FIVE_E_2014_CHARACTER } from '../../../src/app/statblocks/presets/fiveECharacter';
import { derivedValues } from '../../../src/app/statblocks/values/derivedValues';

/** A sheet as the former engine wrote it, with what it wrote for Fantasy Statblocks. */
const FORMER = {
  'atlas-sheet': 'dnd5e-2014', statblock: true, name: 'Lia', class: 'Guerrier', level: 3, alignment: 'Chaotic Good', stats: [10, 16, 12, 14, 13, 8],
  classes: [{ name: 'Guerrier', level: 3, die: 'd10' }], 'save-proficiencies': ['con', 'str'], 'skill-proficiencies': ['stealth'], 'skill-expertise': [],
  inspiration: true, 'hp-temp': 2, 'initiative-bonus': 1, 'hit-dice': '3d10', 'spell-ability': 'wis', 'spell-slots': [2, 0, 0, 0, 0, 0, 0, 0, 0],
  'spell-slots-spent': [1, 0, 0, 0, 0, 0, 0, 0, 0], 'spell-list': [{ level: 1, name: 'Soins', prepared: true, notes: '' }],
  attacks: [{ name: 'Épée', bonus: '+5', damage: '1d8+3', notes: 'polyvalente' }], traits: [], saves: [{ str: 4 }], senses: 'passive Perception 11',
  'atlas-player-notes': ['[[Carte]]'],
};

describe('moving a former sheet onto the template', () => {
  it('names the template of its rules and writes every value as the template reads it', () => {
    const migrated = migratedSheet(FORMER);
    expect(migrated?.set).toMatchObject({
      statblock: true, 'atlas-template': FIVE_E_2014_CHARACTER.id, alignment: 'Chaotique Bon', save_proficiencies: 'Force, Constitution',
      skill_proficiencies: 'Discrétion', inspiration: 'Oui', hp_temp: 2, initiative_bonus: 1, hit_dice: '3d10', spell_ability: 'Sagesse',
      classes: [{ name: 'Guerrier', level: 3, die: 'd10' }], attacks: [{ name: 'Épée', desc: 'polyvalente', bonus: '+5', damage: '1d8+3' }],
      spell_list: [{ name: 'Soins', level: 1, prepared: 'Préparé' }], spell_slots: [{ name: 'Niveau 1', max: 2, used: 1 }],
    });
    expect(migrated?.set).not.toHaveProperty('skill_expertise');
    expect(migrated?.remove).toEqual(expect.arrayContaining(['atlas-sheet', 'hp-temp', 'save-proficiencies', 'spell-slots', 'saves', 'senses']));
    expect(migrated?.remove).not.toContain('atlas-player-notes');
    const note = { ...FORMER, ...migrated?.set };
    for (const key of migrated?.remove ?? []) delete (note as Record<string, unknown>)[key];
    expect(derivedValues(FIVE_E_2014_CHARACTER.template, note).get('initiative')).toBe(4);
  });

  it('leaves any other note alone', () => {
    expect(migratedSheet({ statblock: true, name: 'Gobelin' })).toBeNull();
  });
});
