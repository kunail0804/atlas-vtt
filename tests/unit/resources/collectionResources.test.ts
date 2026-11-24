import { describe, expect, it, vi } from 'vitest';
import { collectionResources, legacyCollectionResources, mapResources } from '../../../src/app/resources/collectionResources';
import { parseResourceDefinitions } from '../../../src/app/resources/resourceDefinitions';
import { BUILT_IN_SYSTEM_PRESETS } from '../../../src/app/gameSystems/builtInPresets';
import { sceneShowsSecondaryBar, storeLegacyResources } from '../../../src/app/resources/legacyResourcesMigration';
import { STR } from '../../mocks/resourceFixtures';
import type { CollectionSettings } from '../../../src/app/types/collectionSettingsTypes';
import type { TokenEntity } from '../../../src/app/types';
import { sceneFromFile, sceneToFile, tokenFromFile, tokenSettingsFromFile, tokenSettingsToFile, tokenToFile } from '../../../src/app/resources/resourceFileFormat';

/** A scene file as 0.4.2 writes it. */
const scene = (showStressBars: boolean | undefined, tokens: Record<string, unknown>): string => JSON.stringify({
  version: 4,
  state: { version: 4, tokenSettings: { showNameplates: true, showHPBars: true, ...(showStressBars !== undefined && { showStressBars }) }, objects: { tokens } },
});
const goblin = { kind: 'character', name: 'Goblin', hp: { current: 7, max: 7 } };
const cultist = { ...goblin, name: 'Cultist', stress: 2, maxStress: 6 };

describe('legacyCollectionResources', () => {
  it('takes the recorded preset first', () => {
    const keys = legacyCollectionResources({ systemPresetId: 'builtin:cairn' }, BUILT_IN_SYSTEM_PRESETS).map((d) => d.key);
    expect(keys).toEqual(['hp', 'str']);
  });

  it('drops broken definitions when a collection index is loaded', () => {
    expect(parseResourceDefinitions([{ key: 'hp', name: 'HP', field: 'hp', direction: 'drains', color: '#22c55e', visibleToPlayers: true }, { key: 'hp', name: 'Dup' }, null]).map((d) => d.key)).toEqual(['hp']);
  });

  it('adds the secondary bar the old default widgets switched on', () => {
    expect(legacyCollectionResources({ defaultWidgets: { hpBar: true, stressBar: true } }, []).map((d) => d.key)).toEqual(['hp', 'stress']);
    expect(legacyCollectionResources({ defaultWidgets: { initiativeTracker: true } }, []).map((d) => d.key)).toEqual(['hp']);
    expect(legacyCollectionResources({}, []).map((d) => d.key)).toEqual(['hp']);
  });

  it('keeps hit points where the old HP bar was switched off: Edit token and the DM screen still showed them', () => {
    expect(legacyCollectionResources({ defaultWidgets: { hpBar: false, stressBar: true } }, []).map((d) => d.key)).toEqual(['hp', 'stress']);
    expect(legacyCollectionResources({ systemPresetId: 'builtin:dnd5e', defaultWidgets: { hpBar: false } }, BUILT_IN_SYSTEM_PRESETS).map((d) => d.key)).toEqual(['hp']);
  });

  it('keeps the bars the collection itself switched on or off, whatever its preset lists', () => {
    const keys = (systemPresetId: string, defaultWidgets: Record<string, boolean>): string[] =>
      legacyCollectionResources({ systemPresetId, defaultWidgets }, BUILT_IN_SYSTEM_PRESETS).map((d) => d.key);
    expect(keys('builtin:coc7e', { hpBar: true, stressBar: true })).toEqual(['hp', 'stress']);
    expect(keys('builtin:daggerheart', { hpBar: true, stressBar: false })).toEqual(['hp']);
    expect(keys('builtin:cairn', { hpBar: true })).toEqual(['hp', 'str']);
  });

  it('adds the secondary bar a scene shows, though the collection never switched it on', () => {
    const names = (settings: Parameters<typeof legacyCollectionResources>[0]): string[] =>
      legacyCollectionResources(settings, BUILT_IN_SYSTEM_PRESETS, true).map((d) => d.name);
    expect(names({ systemPresetId: 'builtin:dnd5e', defaultWidgets: { hpBar: true } })).toEqual(['HP', 'Secondary resource']);
    expect(names({ defaultWidgets: { hpBar: true, stressBar: false } })).toEqual(['HP', 'Secondary resource']);
    // The preset names it
    expect(names({ systemPresetId: 'builtin:daggerheart', defaultWidgets: { hpBar: true, stressBar: false } })).toEqual(['HP', 'Stress']);
  });

  it('calls the secondary bar what the old settings called it, and keeps its key', () => {
    const [, secondary] = legacyCollectionResources({ defaultWidgets: { stressBar: true } }, []);
    expect(secondary).toMatchObject({ key: 'stress', name: 'Secondary resource', field: 'stress', direction: 'fills' });
  });

  it('reads a collection that never stored resources the same way', () => {
    expect(collectionResources({ systemPresetId: 'builtin:daggerheart' }).map((d) => d.key)).toEqual(['hp', 'stress']);
    expect(collectionResources({}).map((d) => d.key)).toEqual(['hp']);
    expect(collectionResources({ resources: [] })).toEqual([]);
  });

  it('never reads more resources than a token shows, wherever the settings came from', () => {
    const seven = ['hp', 'str', 'ammo', 'luck', 'mana', 'grit', 'fuel'].map((key) => ({ key, name: key, field: key, direction: 'drains' as const, color: '#22c55e', visibleToPlayers: false }));
    expect(collectionResources({ resources: seven }).map((d) => d.key)).toEqual(['hp', 'str', 'ammo', 'luck', 'mana', 'grit']);
  });

  it('gives a map outside every collection the two bars every map had', () => {
    const assets = { getCollectionForMap: () => null, getCollectionSettings: () => ({ conditions: [] }), playedSystem: () => null };
    expect(mapResources(assets, 'maps/old cave.atlasmap').map((d) => d.name)).toEqual(['HP', 'Secondary resource']);
    expect(mapResources(assets, null).map((d) => d.name)).toEqual(['HP', 'Secondary resource']);
  });

  it('reads a collection\'s map as HP alone while the index does not know the collection yet', () => {
    const assets = { getCollectionForMap: () => null, getCollectionSettings: () => ({ conditions: [] }), playedSystem: () => null };
    expect(mapResources(assets, 'atlas-vtt/collections/Own/scenes/Cave.atlasmap').map((d) => d.name)).toEqual(['HP']);
  });
});

it('sceneShowsSecondaryBar', () => {
  // is true for a scene that shows the bar and holds a token with a value
  {
    expect(sceneShowsSecondaryBar(scene(true, { a: goblin, b: cultist }))).toBe(true);
    expect(sceneShowsSecondaryBar(scene(true, { b: { ...cultist, stress: { current: 0, max: 6 } } }))).toBe(true);
  }

  // is true for a scene without token settings, which showed both bars
  {
    expect(sceneShowsSecondaryBar(JSON.stringify({ version: 4, state: { objects: { tokens: { b: cultist } } } }))).toBe(true);
  }

  // is false while the switch is off or no token has a value
  {
    expect(sceneShowsSecondaryBar(scene(false, { b: cultist }))).toBe(false);
    expect(sceneShowsSecondaryBar(scene(undefined, { b: cultist }))).toBe(false);
    expect(sceneShowsSecondaryBar(scene(true, { a: goblin }))).toBe(false);
  }

  // is false for a file that is no scene
  {
    expect(sceneShowsSecondaryBar('not json')).toBe(false);
    expect(sceneShowsSecondaryBar('null')).toBe(false);
    expect(sceneShowsSecondaryBar('{"state":{"tokenSettings":{"showStressBars":true},"objects":{"tokens":[null]}}}')).toBe(false);
  }
});

it('storeLegacyResources', async () => {
  const run = async (
    collections: Array<{ id: string; settings?: CollectionSettings }>,
    scenes: Record<string, string[]> = {},
  ): Promise<Record<string, string[]>> => {
    const stored: Record<string, string[]> = {};
    await storeLegacyResources({
      getCollections: async () => collections,
      updateCollectionSettings: async (id, settings) => { stored[id] = settings.resources!.map((d) => d.name); },
    }, async (id) => scenes[id] ?? []);
    return stored;
  };

  // stores the resources of every collection saved before resources existed
  {
    expect(await run([
      { id: 'Plain', settings: { conditions: [], defaultWidgets: { hpBar: true } } },
      { id: 'Daggerheart', settings: { conditions: [], systemPresetId: 'builtin:daggerheart', defaultWidgets: { hpBar: true, stressBar: true } } },
      { id: 'Bare' },
    ])).toEqual({ Plain: ['HP'], Daggerheart: ['HP', 'Stress'], Bare: ['HP'] });
  }

  // adds the secondary bar a collection uses only through a scene switch
  {
    const dnd: CollectionSettings = { conditions: [], systemPresetId: 'builtin:dnd5e', defaultWidgets: { hpBar: true } };
    expect(await run(
      [{ id: 'Used', settings: dnd }, { id: 'Unused', settings: dnd }],
      { Used: [scene(false, { a: goblin }), scene(true, { b: cultist })], Unused: [scene(false, { b: cultist })] },
    )).toEqual({ Used: ['HP', 'Secondary resource'], Unused: ['HP'] });
  }

  // leaves a collection alone that has its resources, an empty list too
  {
    const readScenes = vi.fn(async () => [scene(true, { b: cultist })]);
    const updateCollectionSettings = vi.fn();
    await storeLegacyResources({
      getCollections: async () => [
        { id: 'Own', settings: { conditions: [], resources: [STR] } },
        { id: 'None', settings: { conditions: [], resources: [] } },
      ],
      updateCollectionSettings,
    }, readScenes);
    expect(updateCollectionSettings).not.toHaveBeenCalled();
    expect(readScenes).not.toHaveBeenCalled();
  }

  // stores the other collections when one cannot be read, and fails so the next start tries again
  {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stored: string[] = [];
    await expect(storeLegacyResources({
      getCollections: async () => [{ id: 'Broken' }, { id: 'Fine' }],
      updateCollectionSettings: async (id) => { stored.push(id); },
    }, async (id) => { if (id === 'Broken') throw new Error('unreadable'); return []; })).rejects.toThrow('Broken');
    expect(stored).toEqual(['Fine']);
  }

  // reads no scene of a collection whose default widgets already switch the secondary bar on
  {
    const readScenes = vi.fn(async () => []);
    const stored: Record<string, string[]> = {};
    await storeLegacyResources({
      getCollections: async () => [{ id: 'Daggerheart', settings: { conditions: [], systemPresetId: 'builtin:daggerheart', defaultWidgets: { hpBar: true, stressBar: true } } }],
      updateCollectionSettings: async (id, settings) => { stored[id] = settings.resources!.map((d) => d.name); },
    }, readScenes);
    expect(stored).toEqual({ Daggerheart: ['HP', 'Stress'] });
    expect(readScenes).not.toHaveBeenCalled();
  }
});

it('tokenFromFile', () => {
  // reads object HP and numeric stress as resources
  {
    const token = { id: 't1', kind: 'character', hp: { current: 5, max: 12 }, stress: 2, maxStress: 6 };
    expect(tokenFromFile(token)).toEqual({ id: 't1', kind: 'character', resources: { hp: { current: 5, max: 12 }, stress: { current: 2, max: 6 } } });
  }

  // keeps the old display maxima for bare numbers
  {
    expect(tokenFromFile({ hp: 12, stress: 3 }).resources).toEqual({ hp: { current: 12, max: 100 }, stress: { current: 3, max: 10 } });
  }

  // raises the display maximum to a bare number above it
  {
    expect(tokenFromFile({ hp: 150, stress: 12 }).resources).toEqual({ hp: { current: 150, max: 150 }, stress: { current: 12, max: 12 } });
  }

  // reads the DM screen's quantities under the keys the file has, and never over HP, Stress or Hope
  {
    const token = tokenFromFile({
      stress: 2, maxStress: 6,
      statblockResources: { 'resources.Mana': { current: 3, max: 10 }, luck: { current: 2, max: 5 }, stress: { current: 0, max: 3 } },
    });
    expect(token.resources).toEqual({ stress: { current: 2, max: 6 }, 'resources.Mana': { current: 3, max: 10 }, luck: { current: 2, max: 5 } });
  }

  // carries hope and the override flags, and drops the file's fields
  {
    const token = tokenFromFile({ hope: { current: 2, max: 6 }, maxHpOverridden: true, maxStressOverridden: false, hp: { current: 9, max: 9 }, overriddenMax: ['str'] });
    expect(token.resources).toEqual({ hp: { current: 9, max: 9 }, hope: { current: 2, max: 6 } });
    expect(token.overriddenMax).toEqual(['hp', 'str']);
    expect(token).not.toHaveProperty('hp');
    expect(token).not.toHaveProperty('maxHpOverridden');
  }

  // leaves a token without resources alone
  {
    const token = { id: 't1', kind: 'token' };
    expect(tokenFromFile(token)).toBe(token);
  }

  // lets the file's fields decide over a `resources` entry: an older Atlas wrote them last
  {
    expect(tokenFromFile({ hp: { current: 3, max: 9 }, resources: { hp: { current: 7, max: 9 }, str: { current: 1, max: 4 } } }).resources)
      .toEqual({ hp: { current: 3, max: 9 }, str: { current: 1, max: 4 } });
  }
});

it('tokenToFile', () => {
  const token = {
    id: 't1', kind: 'character', name: 'Root Goblin',
    resources: {
      hp: { current: 3, max: 8 }, stress: { current: 2, max: 6 }, hope: { current: 1, max: 6 },
      str: { current: 9, max: 10 }, 'resources.Mana': { current: 0, max: 4 },
    },
    overriddenMax: ['hp', 'str'],
  };

  // writes the fields every Atlas reads
  {
    expect(tokenToFile(token)).toEqual({
      id: 't1', kind: 'character', name: 'Root Goblin',
      hp: { current: 3, max: 8 },
      stress: { current: 2, max: 6 }, maxStress: 6,
      hope: { current: 1, max: 6 },
      statblockResources: { str: { current: 9, max: 10 }, 'resources.Mana': { current: 0, max: 4 } },
      maxHpOverridden: true,
      overriddenMax: ['str'],
    });
  }

  // is undone by reading the file
  {
    expect(tokenFromFile(tokenToFile(token))).toEqual(token);
    const stressed = { resources: { stress: { current: 0, max: 3 } }, overriddenMax: ['stress'] };
    expect(tokenFromFile(tokenToFile(stressed))).toEqual(stressed);
  }

  // leaves a token without resources alone
  {
    const plain = { id: 't2', kind: 'token' } as TokenEntity;
    expect(tokenToFile(plain)).toBe(plain);
  }

  // shows an older Atlas what it changed there: its numbers come back
  {
    const file = tokenToFile(token) as Record<string, unknown>;
    const edited = { ...file, hp: { current: 1, max: 8 }, maxHpOverridden: false, statblockResources: { str: { current: 4, max: 10 } } };
    expect(tokenFromFile(edited)).toMatchObject({
      resources: { hp: { current: 1, max: 8 }, stress: { current: 2, max: 6 }, str: { current: 4, max: 10 } },
      overriddenMax: ['str'],
    });
  }
});

it('sceneFromFile', () => {
  // reads what each of the two switches hid on the map
  {
    const hidden = (tokenSettings: Record<string, unknown>): unknown => sceneFromFile({ tokenSettings }).tokenSettings;
    expect(hidden({ showHPBars: false, showStressBars: false, showNameplates: true })).toEqual({ showNameplates: true, hiddenResources: ['hp', 'stress'] });
    expect(hidden({ showHPBars: true, showStressBars: false })).toEqual({ hiddenResources: ['stress'] });
    expect(hidden({ showHPBars: true, showStressBars: true })).toEqual({ hiddenResources: [] });
    // A scene that showed only the secondary bar keeps hiding HP
    expect(hidden({ showHPBars: false, showStressBars: true })).toEqual({ hiddenResources: ['hp'] });
  }

  // lets the switches decide when they disagree with the list: an older Atlas changed them
  {
    const hidden = (tokenSettings: Record<string, unknown>): unknown => sceneFromFile({ tokenSettings }).tokenSettings;
    expect(hidden({ hiddenResources: ['ammo'], showHPBars: false, showStressBars: true })).toEqual({ hiddenResources: ['ammo', 'hp'] });
    expect(hidden({ hiddenResources: ['hp', 'stress', 'ammo'], showHPBars: true, showStressBars: true })).toEqual({ hiddenResources: ['ammo'] });
  }

  // reads the single switch of earlier builds of this feature
  {
    expect(sceneFromFile({ tokenSettings: { showResources: false } }).tokenSettings).toEqual({ hiddenResources: ['hp', 'stress'] });
    expect(sceneFromFile({ tokenSettings: { showResources: true } }).tokenSettings).toEqual({ hiddenResources: [] });
  }

  // reads tokens and drops the vitals initiative entries copy from them
  {
    const scene = sceneFromFile({
      objects: { tokens: { t1: { id: 't1', hp: { current: 1, max: 2 } } }, walls: {} },
      initiative: { round: 2, entries: [{ id: 'e1', tokenId: 't1', hp: { current: 1, max: 2 }, stress: { current: 0, max: 6 }, isDefeated: false, order: 0 }] },
    });
    expect(scene.objects).toEqual({ tokens: { t1: { id: 't1', resources: { hp: { current: 1, max: 2 } } } }, walls: {} });
    expect(scene.initiative).toEqual({ round: 2, entries: [{ id: 'e1', tokenId: 't1', order: 0 }] });
  }

  // takes a scene without those parts, or with unreadable ones, as it is
  {
    expect(sceneFromFile({})).toEqual({});
    expect(sceneFromFile({ initiative: null, objects: {} })).toEqual({ initiative: null, objects: {} });
    expect(sceneFromFile({ initiative: { entries: 'broken' } })).toEqual({ initiative: { entries: 'broken' } });
  }
});

it('sceneToFile', () => {
  const scene = {
    grid: { size: 70 },
    objects: {
      tokens: {
        t1: { id: 't1', resources: { hp: { current: 0, max: 8 }, stress: { current: 2, max: 6 } } },
        t2: { id: 't2', resources: { hp: { current: 5, max: 5 } } },
        t3: { id: 't3' },
      },
      walls: {},
    },
    tokenSettings: { showNameplates: true, hiddenResources: ['stress', 'ammo'] },
    initiative: { round: 1, entries: [{ id: 'e1', tokenId: 't1', order: 0 }, { id: 'e2', tokenId: 't2', order: 1 }, { id: 'e3', tokenId: 't3', order: 2 }, { id: 'e4', tokenId: 'gone', order: 3 }] },
  };

  // writes tokens, the two switches and the initiative copies as every Atlas reads them
  {
    const file = sceneToFile(scene);
    expect(file.grid).toBe(scene.grid);
    expect(file.objects.tokens.t1).toEqual({ id: 't1', hp: { current: 0, max: 8 }, stress: { current: 2, max: 6 }, maxStress: 6 });
    expect(file.objects.walls).toBe(scene.objects.walls);
    expect(file.tokenSettings).toEqual({ showNameplates: true, hiddenResources: ['stress', 'ammo'], showHPBars: true, showStressBars: false });
    expect(file.initiative.entries).toEqual([
      { id: 'e1', tokenId: 't1', order: 0, hp: { current: 0, max: 8 }, stress: { current: 2, max: 6 }, isDefeated: true },
      { id: 'e2', tokenId: 't2', order: 1, hp: { current: 5, max: 5 }, isDefeated: false },
      { id: 'e3', tokenId: 't3', order: 2, isDefeated: false },
      { id: 'e4', tokenId: 'gone', order: 3, isDefeated: false },
    ]);
  }

  // is undone by reading the file, and never changes the scene it is given
  {
    const before = structuredClone(scene);
    expect(sceneFromFile(sceneToFile(scene))).toEqual(scene);
    expect(scene).toEqual(before);
  }

  // writes a state without a scene as it is
  {
    expect(sceneToFile({})).toEqual({});
  }
});

it('token settings in a file', () => {
  // tell an older Atlas the two switches it knows
  {
    expect(tokenSettingsToFile({ hiddenResources: [] })).toEqual({ hiddenResources: [], showHPBars: true, showStressBars: true });
    expect(tokenSettingsToFile({ hiddenResources: ['stress', 'ammo'] })).toMatchObject({ showHPBars: true, showStressBars: false });
    expect(tokenSettingsToFile({ showNameplates: true })).toEqual({ showNameplates: true, showHPBars: true, showStressBars: true });
  }

  // are left alone when they hold neither switches nor a list
  {
    const current = { showNameplates: true, hiddenResources: ['stress'] };
    expect(tokenSettingsFromFile(current)).toBe(current);
  }
});

describe('unrelated saved fields', () => {
  it('preserves old character values and an existing initiative icon through a scene round trip', () => {
    const token = {
      id: 'hero', kind: 'character', name: 'Hero', x: 0, y: 0, imagePath: 'hero.webp',
      playerLinked: true, playerId: 'old-player', playerCharacterId: 'old-character',
      hp: { current: 5, max: 12 },
    };
    const scene = {
      objects: { tokens: { hero: token } },
      initiative: { entries: [{ id: 'entry', tokenId: 'hero', isNPC: false }] },
    };

    const saved = sceneToFile(sceneFromFile(scene));

    expect(saved.objects.tokens.hero).toEqual(token);
    expect(saved.initiative.entries[0]?.isNPC).toBe(false);
  });
});
