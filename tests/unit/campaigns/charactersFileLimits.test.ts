import { describe, expect, it } from 'vitest';
import { partyValuesOf, withPartyChanges, type PartyChanges } from '../../../src/app/campaigns/partyValues/charactersFile';
import { partyKey } from '../../../src/app/campaigns/partyValues/partyKeys';
import { emptyTableCharacters } from '../../../src/app/campaigns/partyValues/tableCharactersFile';

const value = { current: 1, max: 2 };
const changes = (entries: [string, string][]): PartyChanges => new Map(entries.map(([character, key]) => [partyKey(character, key), value]));
const characterCount = (stored: ReturnType<typeof emptyTableCharacters>): number => Object.keys(stored.characters as object).length;

describe('the table\'s characters file is written within what it is read with', () => {
  it('takes no character past the 500th, and still changes those it has', () => {
    const full = withPartyChanges(emptyTableCharacters(), changes(Array.from({ length: 500 }, (_, i) => [`tok${i}`, 'hp'])));
    expect(characterCount(full)).toBe(500);
    const next = withPartyChanges(full, new Map([[partyKey('tok500', 'hp'), value], [partyKey('tok0', 'hp'), { current: 2, max: 2 }]]));
    expect(characterCount(next)).toBe(500);
    expect(partyValuesOf(next)[partyKey('tok0', 'hp')]).toEqual({ current: 2, max: 2 });
  });

  it('takes no value past the 200th of a character', () => {
    const full = withPartyChanges(emptyTableCharacters(), changes(Array.from({ length: 201 }, (_, i) => ['tok1', `r${i}`])));
    expect(Object.keys(partyValuesOf(full))).toHaveLength(200);
    expect(partyValuesOf(full)[partyKey('tok1', 'r200')]).toBeUndefined();
  });

  it('takes no key that is empty or too long, and removes no character it does not have', () => {
    const next = withPartyChanges(emptyTableCharacters(), new Map([
      [partyKey('', 'hp'), value],
      [partyKey('tok1', 'x'.repeat(201)), value],
      [partyKey('tok2', 'hp'), undefined],
    ]));
    expect(next.characters).toEqual({});
  });
});
