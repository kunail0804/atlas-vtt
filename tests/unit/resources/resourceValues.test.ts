import { describe, expect, it, vi } from 'vitest';
import { clampValue, defeatedResources, isDefeated, isSpent, resourceUpdate, restedResources, startingValue, withCurrent } from '../../../src/app/resources/resourceValues';
import type { ResourceDefinition, ResourceHolder } from '../../../src/app/resources/resourceTypes';
import { ARMOR, HP } from '../../mocks/resourceFixtures';
import { shapeOf, visibleResources } from '../../../src/app/resources/visibleResources';
import type { PlayedSystem, RulesLookup } from '../../../src/app/gameSystems/mapRules';
import { mapResources } from '../../../src/app/resources/collectionResources';
import { draftResourceKey, HP_RESOURCE, savedResources } from '../../../src/app/resources/resourceDefinitions';
import { tokenFromFile, tokenToFile } from '../../../src/app/resources/resourceFileFormat';
import { fillMissingResources } from '../../../src/app/resources/statblockResourceSync';
import { startingResources } from '../../../src/app/resources/statblockResourceValues';
import type { CollectionSettings } from '../../../src/app/types/collectionSettingsTypes';
import { dnd5eSystem } from '../../mocks/playedCampaignWorld';

const drains: ResourceDefinition = { key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', defeatedWhenSpent: true, visibleToPlayers: true };
const fills: ResourceDefinition = { ...drains, key: 'stress', name: 'Stress', field: 'stress', direction: 'fills', defeatedWhenSpent: false };

const def = (key: string, visibleToPlayers: boolean): ResourceDefinition => ({ key, name: key.toUpperCase(), field: key, direction: 'drains', color: '#ffffff', visibleToPlayers });

/**
 * A custom 5e collection that tracks spell slots per level from a statblock list (`spell_slots.0`,
 * `spell_slots.1`, …) as wheels, as reported in #623, followed from the Resources tab to the token's file.
 */

const MAP = 'atlas-vtt/collections/heroes/scenes/keep.atlasmap';
const SHEET = { name: 'Acer', hp: 66, spell_slots: [4, 3, 2, 0, 0] };

/** The resources as the Resources tab saves them: added in the dialog, keyed from their names. */
function spellSlotResources(): ResourceDefinition[] {
  const wheel = (name: string, field: string, slot: number): ResourceDefinition => ({
    key: draftResourceKey(), name, field, direction: 'drains', color: '#a855f7', visibleToPlayers: false, slot,
  });
  return savedResources([
    { ...HP_RESOURCE, slot: 0 },
    wheel('Lvl 1', 'spell_slots.0', 2),
    wheel('Lvl 2', 'spell_slots.1', 4),
    wheel('Lvl 3', 'spell_slots.2', 5),
    wheel('spell_slots.3', 'spell_slots.3', 3),
  ]);
}

function lookup(settings: CollectionSettings, played: PlayedSystem | null = null): RulesLookup {
  return {
    getCollectionForMap: (path) => (path === MAP ? 'heroes' : null),
    getCollectionSettings: () => settings,
    playedSystem: () => played,
  };
}

describe('resource values', () => {
  it('starts draining resources full and filling resources empty', () => {
    expect(startingValue(drains, 8)).toEqual({ current: 8, max: 8 });
    expect(startingValue(fills, 6)).toEqual({ current: 0, max: 6 });
  });

  it('clamps current into 0..max', () => {
    expect(clampValue({ current: 12, max: 8 })).toEqual({ current: 8, max: 8 });
    expect(clampValue({ current: -3, max: 8 })).toEqual({ current: 0, max: 8 });
    expect(withCurrent({ current: 4, max: 8 }, 9)).toEqual({ current: 8, max: 8 });
  });

  it('is spent at 0 when draining and at max when filling', () => {
    expect(isSpent(drains, { current: 0, max: 8 })).toBe(true);
    expect(isSpent(drains, { current: 1, max: 8 })).toBe(false);
    expect(isSpent(fills, { current: 6, max: 6 })).toBe(true);
    expect(isSpent(fills, { current: 0, max: 6 })).toBe(false);
  });

  it('never counts a resource without a maximum as spent', () => {
    expect(isSpent(drains, { current: 0, max: 0 })).toBe(false);
  });

  it('marks a token defeated when a defeating resource is spent', () => {
    expect(isDefeated({ resources: { hp: { current: 0, max: 8 } } }, [drains, fills])).toBe(true);
    expect(isDefeated({ resources: { stress: { current: 6, max: 6 } } }, [drains, fills])).toBe(false);
    expect(isDefeated({}, [drains])).toBe(false);
  });

  it('records a hand-set maximum once and keeps other values', () => {
    const token = { resources: { hp: { current: 5, max: 8 }, str: { current: 12, max: 12 } }, overriddenMax: ['str'] };
    expect(resourceUpdate(token, 'hp', { current: 5, max: 10 }, true)).toEqual({
      resources: { hp: { current: 5, max: 10 }, str: { current: 12, max: 12 } },
      overriddenMax: ['str', 'hp'],
    });
    expect(resourceUpdate(token, 'hp', { current: 3, max: 8 }, false)).toEqual({
      resources: { hp: { current: 3, max: 8 }, str: { current: 12, max: 12 } },
    });
  });

  it('kills a token by spending every resource that defeats it', () => {
    const token = { resources: { hp: { current: 5, max: 8 }, stress: { current: 2, max: 6 }, mana: { current: 1, max: 4 } } };
    expect(defeatedResources(token, [drains, fills])).toEqual({ hp: { current: 0, max: 8 }, stress: { current: 2, max: 6 }, mana: { current: 1, max: 4 } });
    const marked = { ...fills, key: 'hp', defeatedWhenSpent: true };
    expect(defeatedResources({ resources: { hp: { current: 1, max: 6 } } }, [marked])).toEqual({ hp: { current: 6, max: 6 } });
  });

  it('rests a token by returning every defined resource to its start', () => {
    const token = { resources: { hp: { current: 1, max: 8 }, stress: { current: 5, max: 6 }, mana: { current: 1, max: 4 } } };
    expect(restedResources(token, [drains, fills])).toEqual({ hp: { current: 8, max: 8 }, stress: { current: 0, max: 6 }, mana: { current: 1, max: 4 } });
  });

  it('leaves a token without resources without any', () => {
    expect(defeatedResources({}, [drains])).toBeUndefined();
    expect(restedResources({}, [drains])).toBeUndefined();
  });
});

describe('a static value', () => {
  it('starts at its value and is never spent, whatever a stored flag says', () => {
    expect(startingValue(ARMOR, 15)).toEqual({ current: 15, max: 15 });
    expect(isSpent(ARMOR, { current: 15, max: 15 })).toBe(false);
    expect(isSpent(ARMOR, { current: 0, max: 15 })).toBe(false);
    expect(isDefeated({ resources: { armor: { current: 15, max: 15 } } }, [{ ...ARMOR, defeatedWhenSpent: true }])).toBe(false);
  });
});

it('visibleResources', () => {
  const definitions = [def('hp', true), def('str', false), def('ammo', true)];

  const token = { resources: { str: { current: 12, max: 14 }, hp: { current: 3, max: 8 }, mana: { current: 1, max: 1 } } };

  // lists defined resources with a value in definition order
  {
    expect(visibleResources(token, definitions, 'dm').map((r) => r.definition.key)).toEqual(['hp', 'str']);
  }

  // shows players only what they may see
  {
    expect(visibleResources(token, definitions, 'player').map((r) => r.definition.key)).toEqual(['hp']);
  }

  // shows the player whose character the token is every value it holds
  {
    expect(visibleResources(token, definitions, 'owner').map((r) => r.definition.key)).toEqual(['hp', 'str']);
  }

  // hides values without a usable maximum
  {
    expect(visibleResources({ resources: { hp: { current: 0, max: 0 } } }, definitions, 'dm')).toEqual([]);
  }

  // shows a static value of 0, which is a value and no empty maximum
  {
    const ac: ResourceDefinition = { ...def('ac', true), direction: 'static' };
    expect(visibleResources({ resources: { ac: { current: 0, max: 0 } } }, [ac], 'dm').map((r) => r.value)).toEqual([{ current: 0, max: 0 }]);
  }

  // gives each resource the slot of its place in the collection, whatever the token holds
  {
    const seven = ['hp', 'str', 'ammo', 'luck', 'mana', 'grit', 'fuel'].map((key) => def(key, true));
    const holder = { resources: { ammo: { current: 4, max: 6 }, grit: { current: 1, max: 1 }, fuel: { current: 2, max: 2 }, hp: { current: 3, max: 8 } } };
    // `str` has no value, so `ammo` keeps slot 2; a seventh definition is never shown
    expect(visibleResources(holder, seven, 'dm').map((r) => [r.definition.key, r.slot])).toEqual([['hp', 0], ['ammo', 2], ['grit', 5]]);
  }

  // draws the first two slots as bars and the other four as wheels
  {
    expect([0, 1, 2, 3, 4, 5].map(shapeOf)).toEqual(['bar', 'bar', 'wheel', 'wheel', 'wheel', 'wheel']);
  }
});

describe('resources that read a dotted statblock field (#623)', () => {
  const resources = spellSlotResources();
  const collection: CollectionSettings = { conditions: [], systemPresetId: 'builtin:dnd5e', resources };

  it('keys each by its name, never by its field, so no key holds a dot', () => {
    expect(resources.map(({ key }) => key)).toEqual(['hp', 'lvl-1', 'lvl-2', 'lvl-3', 'spell-slots-3']);
    expect(resources.map(({ field }) => field)).toEqual(['hp', 'spell_slots.0', 'spell_slots.1', 'spell_slots.2', 'spell_slots.3']);
  });

  it('are the resources of the collection\'s maps while no campaign with a system of its own is played', () => {
    expect(mapResources(lookup(collection), MAP)).toEqual(resources);
  });

  it('give way to a played campaign\'s system: its resources are the map\'s, whatever the collection defines', () => {
    const campaign = { campaignId: 'saga', settings: dnd5eSystem() };
    expect(mapResources(lookup(collection, campaign), MAP).map(({ key }) => key)).toEqual(['hp']);
    const withSlots = { campaignId: 'saga', settings: { ...dnd5eSystem(), resources } };
    expect(mapResources(lookup(collection, withSlots), MAP)).toEqual(resources);
  });

  it('start from the list entry the field names; an empty level starts nothing', () => {
    expect(startingResources(SHEET, resources)).toEqual({
      hp: { current: 66, max: 66 },
      'lvl-1': { current: 4, max: 4 },
      'lvl-2': { current: 3, max: 3 },
      'lvl-3': { current: 2, max: 2 },
    });
  });

  it('are started on a linked token placed before they were defined, when its map loads', async () => {
    const tokens: Record<string, ResourceHolder & { statblockPath: string }> = {
      acer: { statblockPath: 'Acer.md', resources: { hp: { current: 40, max: 66 } } },
    };
    const apply = vi.fn();
    await fillMissingResources({ tokens: () => tokens, apply }, resources, async () => ({ fields: SHEET }));
    expect(apply).toHaveBeenCalledWith([{ id: 'acer', changes: { resources: {
      hp: { current: 40, max: 66 },
      'lvl-1': { current: 4, max: 4 },
      'lvl-2': { current: 3, max: 3 },
      'lvl-3': { current: 2, max: 2 },
    } } }]);
  });

  it('show as wheels in their sockets to the GM, and to players only where they are shown to players', () => {
    const token: ResourceHolder = { resources: startingResources(SHEET, resources) };
    expect(visibleResources(token, resources, 'dm').map(({ definition, slot }) => [definition.key, slot])).toEqual([
      ['hp', 0], ['lvl-1', 2], ['lvl-2', 4], ['lvl-3', 5],
    ]);
    expect(visibleResources(token, resources, 'player')).toEqual([]);
  });

  it('keep their values through the scene file, dotted keys of statblock quantities too', () => {
    const token = {
      id: 'acer',
      resources: { ...startingResources(SHEET, resources), 'spell_slots.4': { current: 1, max: 2 } },
      overriddenMax: ['lvl-2', 'spell_slots.4'],
    };
    const file = JSON.parse(JSON.stringify(tokenToFile(token))) as object;
    expect(file).toMatchObject({ statblockResources: { 'lvl-1': { current: 4, max: 4 }, 'spell_slots.4': { current: 1, max: 2 } } });
    expect(tokenFromFile(file)).toEqual(token);
  });
});
