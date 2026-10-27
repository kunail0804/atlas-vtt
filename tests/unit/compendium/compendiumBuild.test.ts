import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { buildSourceNotes } from '../../../compendium/builder/buildSource';
import { challengeRating, sensesText, speedText, usageSuffix } from '../../../compendium/builder/monsters';
import { manifestFor, packSource, sha256Hex } from '../../../compendium/builder/pack';
import { SOURCES } from '../../../compendium/builder/sources';
import type { Note } from '../../../compendium/builder/notes';
import { openSource } from '../../../src/app/compendium/sourceZip';

const ref = (index: string, name: string): Record<string, string> => ({ index, name, url: `/api/2014/x/${index}` });

/** A few SRD records in the shape of 5e-bits/5e-database, enough to touch every kind of note. */
const DATA: Record<string, unknown[]> = {
  Spells: [
    {
      index: 'fireball', name: 'Fireball', level: 3, school: ref('evocation', 'Evocation'), casting_time: '1 action', range: '150 feet',
      components: ['V', 'S', 'M'], material: 'Bat guano.', duration: 'Instantaneous', concentration: false, ritual: false,
      desc: ['A bright streak.', 'The fire spreads.'], higher_level: ['More damage.'],
      damage: [{ damage_type: ref('fire', 'Fire'), damage_at_slot_level: { 3: '8d6', 4: '9d6' } }],
      dc: { dc_type: ref('dex', 'DEX'), dc_success: 'half' }, classes: [ref('wizard', 'Wizard')],
    },
    { index: 'shield', name: 'Shield', level: 1, school: ref('abjuration', 'Abjuration'), desc: ['An invisible barrier.'], classes: [ref('wizard', 'Wizard')] },
  ],
  Monsters: [{
    index: 'goblin', name: 'Goblin', size: 'Small', type: 'humanoid', subtype: 'goblinoid', alignment: 'neutral evil',
    armor_class: [{ type: 'armor', value: 15, armor: [ref('leather-armor', 'Leather Armor'), ref('shield', 'Shield')] }],
    hit_points: 7, hit_dice: '2d6', hit_points_roll: '2d6', speed: { walk: '30 ft.' },
    strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8,
    proficiencies: [{ value: 6, proficiency: ref('skill-stealth', 'Skill: Stealth') }, { value: 4, proficiency: ref('saving-throw-dex', 'Saving Throw: DEX') }],
    damage_vulnerabilities: [], damage_resistances: [], damage_immunities: [], condition_immunities: [ref('charmed', 'Charmed')],
    senses: { darkvision: '60 ft.', passive_perception: 9 }, languages: 'Common, Goblin', challenge_rating: 0.25,
    special_abilities: [{ name: 'Nimble Escape', desc: 'Disengage or Hide.' }],
    actions: [{ name: 'Fire Breath', desc: 'Breathes fire.', usage: { type: 'recharge on roll', dice: '1d6', min_value: 5 } }],
  }],
  Classes: [{
    index: 'wizard', name: 'Wizard', hit_die: 6, saving_throws: [ref('int', 'INT'), ref('wis', 'WIS')],
    proficiencies: [ref('daggers', 'Daggers'), ref('saving-throw-int', 'Saving Throw: INT')],
    proficiency_choices: [{ desc: 'Choose two from Arcana and History' }], subclasses: [ref('evocation', 'Evocation')],
    spellcasting: { spellcasting_ability: ref('int', 'INT') }, multi_classing: { prerequisites: [{ ability_score: ref('int', 'INT'), minimum_score: 13 }] },
  }],
  Levels: [{ index: 'wizard-1', level: 1, prof_bonus: 2, features: [ref('arcane-recovery', 'Arcane Recovery')], class: ref('wizard', 'Wizard'), spellcasting: { cantrips_known: 3, spell_slots_level_1: 2, spell_slots_level_9: 0 }, class_specific: { arcane_recovery_levels: 1 } }],
  Features: [
    { index: 'arcane-recovery', name: 'Arcane Recovery', level: 1, class: ref('wizard', 'Wizard'), desc: ['Regain slots.'] },
    { index: 'sculpt-spells', name: 'Sculpt Spells', level: 2, class: ref('wizard', 'Wizard'), subclass: ref('evocation', 'Evocation'), desc: ['Protect allies.'] },
  ],
  Subclasses: [{ index: 'evocation', name: 'Evocation', class: ref('wizard', 'Wizard'), subclass_flavor: 'Arcane Tradition', desc: ['Elemental effects.'] }],
  Races: [{ index: 'elf', name: 'Elf', speed: 30, size: 'Medium', ability_bonuses: [{ ability_score: ref('dex', 'DEX'), bonus: 2 }], traits: [ref('darkvision', 'Darkvision')], languages: [ref('common', 'Common')] }],
  Subraces: [{ index: 'high-elf', name: 'High Elf', race: ref('elf', 'Elf'), desc: 'Keen mind.', ability_bonuses: [{ ability_score: ref('int', 'INT'), bonus: 1 }], racial_traits: [] }],
  Traits: [{ index: 'darkvision', name: 'Darkvision', desc: ['You see in the dark.'] }],
  Equipment: [{ index: 'shield', name: 'Shield', equipment_category: ref('armor', 'Armor'), armor_category: 'Shield', armor_class: { base: 2, dex_bonus: false }, cost: { quantity: 10, unit: 'gp' }, weight: 6 }],
  'Magic-Items': [{ index: 'cloak', name: 'Cloak of Protection', equipment_category: ref('wondrous-items', 'Wondrous Items'), rarity: { name: 'Uncommon' }, desc: ['Wondrous item, uncommon (requires attunement)', '+1 to AC.'] }],
  Conditions: [{ index: 'charmed', name: 'Charmed', desc: ['- Cannot attack the charmer.'] }],
};

let database = '';
let notes: Note[] = [];
const source = SOURCES.find((candidate) => candidate.edition === '2014');
if (!source) throw new Error('no 2014 source');
const ROOT = 'Compendium/D&D 5e 2014/SRD 5.1';

function note(path: string): { properties: Record<string, unknown>; body: string } {
  const found = notes.find((candidate) => candidate.path === `${ROOT}/${path}`);
  if (!found) throw new Error(`No note ${path}`);
  const [, yaml = '', body = ''] = /^---\n([\s\S]*?)---\n([\s\S]*)$/.exec(found.text) ?? [];
  return { properties: parse(yaml) as Record<string, unknown>, body };
}

beforeAll(() => {
  database = mkdtempSync(join(tmpdir(), 'atlas-srd-'));
  mkdirSync(join(database, 'src', '2014', 'en'), { recursive: true });
  for (const [name, records] of Object.entries(DATA)) writeFileSync(join(database, 'src', '2014', 'en', `5e-SRD-${name}.json`), JSON.stringify(records));
  notes = buildSourceNotes(database, source);
});

afterAll(() => rmSync(database, { recursive: true, force: true }));

describe('building the SRD notes', () => {
  it('puts each kind of entry in its folder, and two entries named alike in different folders apart', () => {
    const paths = notes.map((entry) => entry.path.slice(ROOT.length + 1)).sort();
    expect(paths).toEqual([
      'Attribution.md', 'Classes/Wizard.md', 'Conditions/Charmed.md', 'Equipment/Shield.md', 'Magic Items/Cloak of Protection.md',
      'Monsters/Goblin.md', 'Rules/Weapon Properties.md', 'Species/Elf.md', 'Spells/Fireball.md', 'Spells/Shield.md', 'Subclasses/Evocation.md',
    ]);
  });

  it('writes a spell with its numbers in properties and its text below, linking its classes', () => {
    const { properties, body } = note('Spells/Fireball.md');
    expect(properties).toMatchObject({
      'atlas-compendium': 'spell', 'atlas-system': 'dnd5e-2014', 'atlas-source': 'dnd5e-2014/srd-5.1',
      level: 3, school: 'Evocation', save: 'DEX', 'damage-type': 'Fire', 'damage-at-slot-level': { 3: '8d6', 4: '9d6' },
      classes: [`[[${ROOT}/Classes/Wizard|Wizard]]`],
    });
    expect(body).toContain('*3rd-level evocation*');
    expect(body).toContain('A bright streak.\n\nThe fire spreads.');
    expect(body).toContain('***At Higher Levels.*** More damage.');
  });

  it('writes a monster as a native statblock of the 2014 template', () => {
    const { properties } = note('Monsters/Goblin.md');
    expect(properties).toMatchObject({
      statblock: true, 'atlas-template': 'builtin:5e-2014-monster', 'atlas-compendium': 'monster',
      ac: 15, ac_class: 'leather armor, shield', hp: 7, hit_dice: '2d6', speed: '30 ft.', stats: [8, 14, 10, 10, 8, 8],
      saves: [{ dexterity: 4 }], skillsaves: [{ stealth: 6 }], condition_immunities: 'Charmed',
      senses: 'darkvision 60 ft., passive Perception 9', cr: '1/4',
      traits: [{ name: 'Nimble Escape', desc: 'Disengage or Hide.' }],
      actions: [{ name: 'Fire Breath (Recharge 5–6)', desc: 'Breathes fire.' }],
    });
    expect(properties).not.toHaveProperty('damage_resistances');
  });

  it('writes a class with its table, its own features, its subclasses and its spell list', () => {
    const { properties, body } = note('Classes/Wizard.md');
    expect(properties).toMatchObject({ 'hit-die': 'd6', 'saving-throws': ['INT', 'WIS'], proficiencies: ['Daggers'], 'spellcasting-ability': 'INT', 'multiclass-prerequisites': 'INT 13' });
    expect(body).toContain('| Level | Proficiency Bonus | Features | Arcane Recovery Levels | Cantrips Known | 1st |');
    expect(body).toContain('| 1 | +2 | Arcane Recovery | 1 | 3 | 2 |');
    expect(body).toContain('### Arcane Recovery');
    expect(body).not.toContain('Sculpt Spells');
    expect(body).toContain(`[[${ROOT}/Spells/Fireball|Fireball]]`);
    expect(note('Subclasses/Evocation.md').body).toContain('### Sculpt Spells\n*Level 2*\n\nProtect allies.');
  });

  it('writes a species with its traits and subraces, armour with its numbers, and attunement read from the text', () => {
    const elf = note('Species/Elf.md');
    expect(elf.properties).toMatchObject({ speed: 30, 'ability-bonuses': 'DEX +2', subraces: ['High Elf'] });
    expect(elf.body).toContain('***Darkvision.*** You see in the dark.');
    expect(elf.body).toContain('### High Elf');
    expect(note('Equipment/Shield.md').properties).toMatchObject({ 'item-type': 'shield', 'armor-class': 2, 'dex-bonus': false, cost: '10 gp' });
    expect(note('Magic Items/Cloak of Protection.md').properties).toMatchObject({ rarity: 'Uncommon', attunement: true });
  });
});

describe('packing a source', () => {
  it('lists every note with its SHA-256, gives the same bytes twice, and opens in Atlas', async () => {
    const manifest = manifestFor(source, notes);
    expect(manifest.files).toHaveLength(notes.length);
    const fireball = notes.find((entry) => entry.path.endsWith('Fireball.md'));
    expect(manifest.files.find((file) => file.path === fireball?.path)?.sha256).toBe(sha256Hex(fireball?.text ?? ''));
    const first = await packSource(manifest, notes);
    const second = await packSource(manifest, [...notes].reverse());
    expect(sha256Hex(first)).toBe(sha256Hex(second));
    const opened = await openSource(first.slice().buffer);
    expect(opened.manifest.id).toBe('dnd5e-2014/srd-5.1');
    expect(new TextDecoder().decode(await opened.read(fireball?.path ?? ''))).toBe(fireball?.text);
  });
});

describe('monster lines', () => {
  it('reads challenge ratings, speeds, senses and usage as the SRD prints them', () => {
    expect([challengeRating(0.125), challengeRating(0.5), challengeRating(21), challengeRating('x')]).toEqual(['1/8', '1/2', '21', '']);
    expect(speedText({ walk: '10 ft.', fly: '90 ft.', hover: true })).toBe('10 ft., fly 90 ft. (hover)');
    expect(sensesText({ blindsight: '30 ft.', passive_perception: 12 })).toBe('blindsight 30 ft., passive Perception 12');
    expect(usageSuffix({ type: 'per day', times: 3 })).toBe(' (3/Day)');
    expect(usageSuffix({ type: 'recharge on roll', dice: '1d6', min_value: 6 })).toBe(' (Recharge 6)');
    expect(usageSuffix({ type: 'recharge after rest', rest_types: ['short', 'long'] })).toBe(' (Recharges after a Short or Long Rest)');
  });
});
