import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { entryCard } from '../../../src/app/compendium/entryCard';

const FIREBALL = `---
atlas-compendium: spell
atlas-system: dnd5e-2014
atlas-source: dnd5e-2014/srd-5.1
name: Fireball
level: 3
school: Evocation
classes:
  - "[[Compendium/D&D 5e 2014/SRD 5.1/Classes/Wizard|Wizard]]"
casting-time: 1 action
components:
  - V
  - S
concentration: false
ritual: true
damage-at-slot-level:
  "3": 8d6
  "4": 9d6
homebrew-note: Mine
---
*3rd-level evocation*

A bright streak.
`;

const frontmatterOf = (text: string): Record<string, unknown> => parse(/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '') as Record<string, unknown>;

describe('a compendium entry as a statblock card', () => {
  it('shows the properties of its kind in their order, then the others, then the text', () => {
    const card = entryCard('spell', FIREBALL, 'file name', 'Yes');
    const { template } = card.template;
    expect(template.fields.filter((field) => field.key === 'name' || field.key.startsWith('card_')).map((field) => [field.label, field.type])).toEqual([
      ['Name', 'text'],
      ['Level', 'text'], ['School', 'text'], ['Casting Time', 'text'], ['Components', 'list'], ['Ritual', 'text'],
      ['Damage by Slot Level', 'text'], ['Classes', 'list'], ['Homebrew note', 'text'],
      ['Text', 'markdown'],
    ]);
    expect(template.layout.blocks.map((block) => block.type)).toEqual(['stat', 'stat', 'stat', 'tags', 'stat', 'stat', 'tags', 'stat', 'divider', 'text']);
    expect(template.header?.hidden).toEqual(['token', 'level', 'type', 'hp', 'description']);
  });

  it('is a native statblock of that template, with readable values and the note\'s text', () => {
    const card = entryCard('spell', FIREBALL, 'file name', 'Yes');
    const values = frontmatterOf(card.text);
    // Each value under the key of the field labelled for it.
    const byLabel = Object.fromEntries(card.template.template.fields.filter((field) => field.key in values).map((field) => [field.label, values[field.key]]));
    expect(values).toMatchObject({ statblock: true, 'atlas-template': card.template.template.id, name: 'Fireball' });
    expect(byLabel).toEqual({
      Name: 'Fireball',
      'Casting Time': '1 action',
      Components: ['V', 'S'],
      Ritual: 'Yes',
      'Damage by Slot Level': '3: 8d6, 4: 9d6',
      Classes: ['[[Compendium/D&D 5e 2014/SRD 5.1/Classes/Wizard|Wizard]]'],
      Level: '3',
      School: 'Evocation',
      'Homebrew note': 'Mine',
      Text: '*3rd-level evocation*\n\nA bright streak.',
    });
    expect(Object.keys(values).some((key) => key.startsWith('atlas-') && key !== 'atlas-template')).toBe(false);
  });

  it('keeps one template id for one set of fields and takes the file name without a name', () => {
    const same = entryCard('spell', FIREBALL.replace('Fireball', 'Ash Bolt'), 'x', 'Yes');
    expect(same.template.template.id).toBe(entryCard('spell', FIREBALL, 'x', 'Yes').template.template.id);
    const bare = entryCard('other', 'Just text.', 'Loose note', 'Yes');
    expect(frontmatterOf(bare.text)).toMatchObject({ name: 'Loose note', card_text: 'Just text.' });
    expect(bare.template.template.layout.blocks.map((block) => block.type)).toEqual(['text']);
  });
});
