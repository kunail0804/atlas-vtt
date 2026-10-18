// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DND5E_2024, deriveDnd5e, proficiencyBonus } from '../../../src/app/characterSheets/dnd5e2024.ts';
import { readField } from '../../../src/app/characterSheets/sheetFields.ts';
import { applySheetEdit, newSheet, readNoteSheet, sheetFrontmatter } from '../../../src/app/characterSheets/sheetNote.ts';
import { parseGmMessage, parsePlayerMessage } from '../../../src/app/online/protocol/index.ts';

const mira = { ...newSheet(DND5E_2024, 'Mira'), level: 5, stats: [8, 16, 14, 12, 13, 10], 'save-proficiencies': ['dex', 'int'], 'skill-proficiencies': ['stealth', 'perception'], 'skill-expertise': ['stealth'], 'spell-ability': 'int', 'initiative-bonus': 1 };

describe('the 2024 rules on a character sheet', () => {
  it('work out modifiers, proficiency, saves, skills, initiative, passive Perception and spellcasting', () => {
    expect([1, 4, 5, 8, 9, 12, 13, 16, 17, 20].map(proficiencyBonus)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    const derived = deriveDnd5e(mira);
    expect(derived.proficiency).toBe(3);
    expect(derived.modifiers).toEqual({ str: -1, dex: 3, con: 2, int: 1, wis: 1, cha: 0 });
    expect(derived.saves).toEqual({ str: -1, dex: 6, con: 2, int: 4, wis: 1, cha: 0 });
    expect(derived.skills.stealth).toBe(9);
    expect(derived.skills.perception).toBe(4);
    expect(derived.skills.athletics).toBe(-1);
    expect(derived.initiative).toBe(4);
    expect(derived.passivePerception).toBe(14);
    expect([derived.spellSaveDc, derived.spellAttack]).toEqual([12, 4]);
    expect(deriveDnd5e({ ...mira, 'spell-ability': '' }).spellSaveDc).toBeNull();
  });

  it('write what Fantasy Statblocks reads beside the sheet\'s own keys, and read the note back as it was', () => {
    const frontmatter = sheetFrontmatter(DND5E_2024, { ...mira, attacks: [{ name: 'Rapière', bonus: '+6', damage: '1d8+3 perforant', notes: '' }] });
    expect(frontmatter).toMatchObject({
      statblock: true, 'atlas-sheet': 'dnd5e-2024', name: 'Mira', stats: [8, 16, 14, 12, 13, 10],
      saves: [{ dex: 6 }, { int: 4 }], skillsaves: [{ perception: 4 }, { stealth: 9 }], senses: 'passive Perception 14',
      actions: [{ name: 'Rapière', desc: '+6 to hit, 1d8+3 perforant' }],
    });
    const read = readNoteSheet({ ...frontmatter, 'atlas-player-notes': ['[[Famille de Mira]]', 3, ''] });
    expect(read?.system.id).toBe('dnd5e-2024');
    expect(read?.values.level).toBe(5);
    expect(read?.playerNotes).toEqual(['[[Famille de Mira]]']);
    expect(readNoteSheet({ statblock: true, name: 'Gobelin' })).toBeNull();
  });

  it('read what a note holds within the sheet\'s bounds, an unreadable value as empty', () => {
    const read = readNoteSheet({ 'atlas-sheet': 'dnd5e-2024', level: 99, stats: [10, 10], 'skill-proficiencies': ['stealth', 'flying', 'arcana'], ac: '17', name: 'A\u0000B' });
    expect(read?.values.level).toBe(1);
    expect(read?.values.stats).toEqual([10, 10, 10, 10, 10, 10]);
    expect(read?.values['skill-proficiencies']).toEqual(['arcana', 'stealth']);
    expect(read?.values.ac).toBe(17);
    expect(read?.values.name).toBe('A B');
    expect(readField({ kind: 'text', max: 3 }, 'abcd')).toBeUndefined();
  });

  it('take a player\'s change only where the system allows it', () => {
    expect(applySheetEdit(DND5E_2024, mira, { op: 'set', key: 'level', value: 6 })?.level).toBe(6);
    expect(applySheetEdit(DND5E_2024, mira, { op: 'set', key: 'level', value: 21 })).toBeNull();
    expect(applySheetEdit(DND5E_2024, mira, { op: 'set', key: 'atlas-sheet', value: 'x' })).toBeNull();
    expect(applySheetEdit(DND5E_2024, mira, { op: 'set', key: 'equipment', value: 'x' })).toBeNull();
    const added = applySheetEdit(DND5E_2024, mira, { op: 'row', key: 'equipment', index: 0, row: { name: 'Corde', quantity: 1, extra: 'ignoré' } });
    expect(added?.equipment).toEqual([{ name: 'Corde', quantity: 1, weight: '', notes: '' }]);
    expect(applySheetEdit(DND5E_2024, added ?? mira, { op: 'row', key: 'equipment', index: 0, row: null })?.equipment).toEqual([]);
    expect(applySheetEdit(DND5E_2024, mira, { op: 'row', key: 'equipment', index: 3, row: { name: 'x' } })).toBeNull();
  });
});

describe('the sheet messages', () => {
  it('reach the player read by the system\'s rules', () => {
    const message = { t: 'sheet', sheet: { system: 'dnd5e-2024', values: { ...mira, level: 50 } }, notes: [{ title: 'Famille', body: 'Texte' }] };
    const parsed = parseGmMessage(JSON.parse(JSON.stringify(message)));
    expect(parsed?.t === 'sheet' ? parsed.sheet?.values.level : undefined).toBe(1);
    expect(parsed?.t === 'sheet' ? parsed.notes : undefined).toEqual([{ title: 'Famille', body: 'Texte' }]);
    expect(parseGmMessage({ t: 'sheet', sheet: { system: 'unknown', values: {} }, notes: [] })).toEqual({ t: 'sheet', sheet: null, notes: [] });
  });

  it('from the player are read by shape', () => {
    expect(parsePlayerMessage({ t: 'sheet-edit', key: 'stats', value: [10, 12, 14, 8, 10, 10] })).toEqual({ t: 'sheet-edit', key: 'stats', value: [10, 12, 14, 8, 10, 10] });
    expect(parsePlayerMessage({ t: 'sheet-edit', key: 'Bad Key', value: 1 })).toBeNull();
    expect(parsePlayerMessage({ t: 'sheet-edit', key: 'name', value: { nested: true } })).toBeNull();
    expect(parsePlayerMessage({ t: 'sheet-row', key: 'attacks', index: 0, row: null })).toEqual({ t: 'sheet-row', key: 'attacks', index: 0, row: null });
    expect(parsePlayerMessage({ t: 'sheet-row', key: 'attacks', index: -1, row: null })).toBeNull();
  });
});
