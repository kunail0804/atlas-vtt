import { describe, expect, it } from 'vitest';
import { editedValue, pageContentOf, withBody } from '../../../src/app/compendium/sharedPage';

const GOBLIN = `---
atlas-compendium: monster
statblock: true
atlas-template: builtin:5e-2014-monster
name: Goblin
size: Small
ac: 15
ac_class: leather armor, shield
hp: 7
stats: [8, 14, 10, 10, 8, 8]
skillsaves:
  - stealth: 6
actions:
  - name: Scimitar
    desc: "Melee Weapon Attack: +4 to hit."
---
`;

const FIREBALL = '---\natlas-compendium: spell\nname: Fireball\nlevel: 3\ncomponents: [V, S, M]\nritual: false\n---\nA bright streak.\n';

describe('a compendium page as a player reads it', () => {
  it('reads a monster in its template\'s order, with its armour, scores, skills and actions', () => {
    const page = pageContentOf(GOBLIN, 'Goblin', 'yes');
    expect(page.title).toBe('Goblin');
    expect(page.kind).toBe('monster');
    expect(page.rows).toEqual([
      { label: 'Size', value: 'Small' },
      { label: 'Armor Class', value: '15 (leather armor, shield)' },
      { label: 'Hit Points', value: '7' },
      { label: 'Abilities', value: 'STR 8 (−1), DEX 14 (+2), CON 10 (+0), INT 10 (+0), WIS 8 (−1), CHA 8 (−1)' },
      { label: 'Skills', value: 'Stealth +6' },
    ]);
    expect(page.sections).toEqual([{ heading: 'Actions', entries: [{ name: 'Scimitar', text: 'Melee Weapon Attack: +4 to hit.' }] }]);
    expect(page.fields.map((field) => field.key)).toEqual(['size', 'ac', 'ac_class', 'hp']);
  });

  it('reads any other entry as its card does, and offers its simple properties to change', () => {
    const page = pageContentOf(FIREBALL, 'Fireball', 'yes');
    expect(page.rows).toEqual([{ label: 'Level', value: '3' }, { label: 'Components', value: 'V, S, M' }]);
    expect(page.text).toBe('A bright streak.');
    expect(page.fields).toEqual([{ key: 'level', label: 'Level', value: '3' }, { key: 'components', label: 'Components', value: 'V, S, M' }]);
  });

  it('writes a change back as the note held it: numbers, lists, and the text under the same frontmatter', () => {
    expect(editedValue(3, '4')).toBe(4);
    expect(editedValue(3, 'four')).toBe('four');
    expect(editedValue(['V', 'S'], 'V, S, M')).toEqual(['V', 'S', 'M']);
    expect(editedValue('Small', 'Tiny')).toBe('Tiny');
    expect(editedValue(undefined, 'x')).toBeNull();
    expect(withBody(FIREBALL, 'A bigger streak.')).toBe('---\natlas-compendium: spell\nname: Fireball\nlevel: 3\ncomponents: [V, S, M]\nritual: false\n---\nA bigger streak.\n');
    expect(withBody('No frontmatter.', 'New')).toBe('New\n');
  });
});
