import { describe, expect, it } from 'vitest';
import { BUILT_IN_SYSTEM_PRESETS } from '../builtInPresets';
import { conditionEffect } from '../conditionEffects';
import { parseUserPreset } from '../presetValidation';
import { sameSystemRules } from '../systemRules';
import { BUILT_IN_SENSES, GENERIC_SENSES, NORMAL_SIGHT } from '../senses';
import { collectionSenses, findSense, perceivedLevel, sameSenses, senseWithRole } from '../senseRules';
import type { LightLevel, SenseDefinition } from '../../types/senseTypes';
import { parseSenseDefinitions, parseTokenSenses } from '../senseValidation';
import { parseVisionDefaults, hasVisionDefaults, sameVisionDefaults } from '../visionDefaults';

const valid: SenseDefinition = {
  id: 'home-1', name: 'Witch sight', description: 'Sees in the dark within its range.', lineOfSight: true,
  sees: { bright: 'normal', dim: 'as-bright', dark: 'as-dim', magicalDark: 'as-bright' }, look: 'heat', reveals: 'all', precise: true,
  seesInvisible: true, worksWhileBlinded: true, range: 'required', defaultRange: 60, ignores: 'airborne', role: 'darkvision',
};

describe('what conditions do to sight', () => {
  const dnd5e = BUILT_IN_SYSTEM_PRESETS.find((preset) => preset.name === 'D&D 5e')!;
  const blinded = dnd5e.rules.conditions.find((condition) => condition.name === 'Blinded')!;

  it('a condition whose effect on sight is switched off', () => {
    // has no effect, also where the built-in condition of its id has one
    {
      expect(conditionEffect({ id: blinded.id })).toBe('blinded');
      expect(conditionEffect({ id: blinded.id, effect: 'none' })).toBeUndefined();
      expect(conditionEffect({ id: 'own-1', effect: 'none' })).toBeUndefined();
    }

    // makes the collection's rules differ from its preset's, and equal again when set back
    {
      const without = { ...dnd5e.rules, conditions: dnd5e.rules.conditions.map((condition) => (condition.id === blinded.id ? { ...condition, effect: 'none' as const } : condition)) };
      expect(sameSystemRules(dnd5e.rules, without)).toBe(false);
      const back = { ...dnd5e.rules, conditions: dnd5e.rules.conditions.map(({ effect: _effect, ...condition }) => condition) };
      expect(sameSystemRules(dnd5e.rules, back)).toBe(true);
    }

    // is kept by a user preset
    {
      const stored = { id: 'user-1', name: 'Homebrew', rules: { gridDefaults: dnd5e.rules.gridDefaults, conditions: [{ ...blinded, effect: 'none' }] } };
      expect(parseUserPreset(stored)?.rules.conditions[0]!.effect).toBe('none');
    }
  });
});

describe('a collection\'s senses', () => {
  const preset = (name: string): (typeof BUILT_IN_SYSTEM_PRESETS)[number] => BUILT_IN_SYSTEM_PRESETS.find((candidate) => candidate.name === name)!;
  const dnd5e = preset('D&D 5e');
  const cairn = preset('Cairn');
  const shadowdark = preset('Shadowdark');
  const DND_SENSES = BUILT_IN_SENSES[dnd5e.id]!;

  const homebrew: SenseDefinition = {
    id: 'home-1', name: 'Witch sight', description: 'Sees in the dark within its range.', lineOfSight: true,
    sees: { bright: 'normal', dim: 'normal', dark: 'as-dim', magicalDark: 'none' }, look: 'colour', reveals: 'all', precise: true,
    seesInvisible: false, worksWhileBlinded: false, range: 'required',
  };

  it('collectionSenses', () => {
    // are the collection's own when it has any, even an empty list
    {
      expect(collectionSenses({ senses: [homebrew], systemPresetId: dnd5e.id }, BUILT_IN_SYSTEM_PRESETS)).toEqual([homebrew]);
      expect(collectionSenses({ senses: [], systemPresetId: dnd5e.id }, BUILT_IN_SYSTEM_PRESETS)).toEqual([]);
    }

    // are those of its recorded preset otherwise
    {
      expect(collectionSenses({ systemPresetId: dnd5e.id }, BUILT_IN_SYSTEM_PRESETS)).toBe(dnd5e.rules.senses);
      expect(collectionSenses({ systemPresetId: shadowdark.id }, BUILT_IN_SYSTEM_PRESETS).map((sense) => sense.id)).toEqual(['shadowdark-darkness-adapted']);
    }

    // are the generic set without a system, with a system that has none, and with a preset that is gone
    {
      expect(collectionSenses({}, BUILT_IN_SYSTEM_PRESETS)).toBe(GENERIC_SENSES);
      expect(collectionSenses({ systemPresetId: cairn.id }, BUILT_IN_SYSTEM_PRESETS)).toBe(GENERIC_SENSES);
      expect(collectionSenses({ systemPresetId: 'deleted' }, BUILT_IN_SYSTEM_PRESETS)).toBe(GENERIC_SENSES);
    }
  });

  it('findSense', () => {
    // finds the collection's sense, else the generic one of that id
    {
      expect(findSense(DND_SENSES, 'dnd5e-truesight')?.name).toBe('Truesight');
      expect(findSense(DND_SENSES, 'blindsight')).toBe(GENERIC_SENSES.find((sense) => sense.id === 'blindsight'));
      expect(findSense([{ ...homebrew, id: 'darkvision' }], 'darkvision')?.name).toBe('Witch sight');
    }

    // knows no other system's senses and no made-up ids
    {
      expect(findSense(DND_SENSES, 'pathfinder2e-scent')).toBeUndefined();
      expect(findSense(DND_SENSES, 'sight')).toBeUndefined();
      expect(findSense([], '')).toBeUndefined();
    }
  });

  it('senseWithRole', () => {
    // is the collection's darkvision or tremorsense where it has one
    {
      expect(senseWithRole(DND_SENSES, 'darkvision').id).toBe('dnd5e-darkvision');
      expect(senseWithRole(DND_SENSES, 'tremorsense').id).toBe('dnd5e-tremorsense');
      expect(senseWithRole(BUILT_IN_SENSES['builtin:ose']!, 'darkvision').id).toBe('ose-infravision');
    }

    // is the generic one where the collection has none
    {
      expect(senseWithRole(BUILT_IN_SENSES[shadowdark.id]!, 'darkvision').id).toBe('darkvision');
      expect(senseWithRole(BUILT_IN_SENSES['builtin:ose']!, 'tremorsense').id).toBe('tremorsense');
      expect(senseWithRole([], 'darkvision').id).toBe('darkvision');
    }
  });

  it('sameSenses', () => {
    // compares every field of every sense, in order
    {
      expect(sameSenses(DND_SENSES, structuredClone(DND_SENSES))).toBe(true);
      expect(sameSenses(DND_SENSES, [...DND_SENSES].reverse())).toBe(false);
      expect(sameSenses(DND_SENSES, DND_SENSES.slice(1))).toBe(false);
      const changes: Partial<SenseDefinition>[] = [
        { id: 'other' }, { name: 'Other' }, { description: 'Other.' }, { lineOfSight: false }, { reveals: 'creatures' }, { precise: false },
        { seesInvisible: true }, { worksWhileBlinded: true }, { range: 'optional' }, { defaultRange: 30 }, { ignores: 'airborne' },
        { look: 'heat' }, { role: 'darkvision' }, { grants: 'see-invisible' }, { sees: { ...homebrew.sees, dim: 'as-bright' } }, { sees: { ...homebrew.sees, magicalDark: 'as-dim' } },
      ];
      for (const change of changes) expect(sameSenses([homebrew], [{ ...homebrew, ...change }])).toBe(false);
      expect(sameSenses([homebrew], [{ ...homebrew, sees: { ...homebrew.sees } }])).toBe(true);
    }

    // reads no senses as the generic set, as a collection does
    {
      expect(sameSenses(undefined, undefined)).toBe(true);
      expect(sameSenses(undefined, GENERIC_SENSES)).toBe(true);
      expect(sameSenses(undefined, [])).toBe(false);
      expect(sameSenses(undefined, DND_SENSES)).toBe(false);
    }
  });

  describe('perceivedLevel', () => {
    const LEVELS: readonly LightLevel[] = ['bright', 'dim', 'dark', 'magical-dark'];
    const perceived = (id: string): (string | null)[] => {
      const sense = [NORMAL_SIGHT, ...GENERIC_SENSES, ...Object.values(BUILT_IN_SENSES).flat()].find((candidate) => candidate.id === id)!;
      return LEVELS.map((level) => perceivedLevel(sense, level));
    };

    it('gives each built-in sense its own level in bright, dim, dark and magical darkness', () => {
      for (const [_rule, id, expected] of [
        ['normal sight sees bright and dim light as they are and nothing in darkness', 'sight', ['bright', 'dim', null, null]],
        ['D&D 5e darkvision sees dim light as bright and darkness as dim, but not magical darkness', 'dnd5e-darkvision', ['bright', 'bright', 'dim', null]],
        ['D&D 5e blindsight perceives the same in every light', 'dnd5e-blindsight', ['bright', 'bright', 'bright', 'bright']],
        ['D&D 5e truesight sees in normal and magical darkness', 'dnd5e-truesight', ['bright', 'bright', 'bright', 'bright']],
        ['D&D 5e devil\'s sight sees normally in dim light and in darkness, magical or not', 'dnd5e-devils-sight', ['bright', 'bright', 'bright', 'bright']],
        ['Pathfinder low-light vision sees dim light as bright and nothing in darkness', 'pathfinder2e-low-light-vision', ['bright', 'bright', null, null]],
        ['Pathfinder darkvision sees perfectly well in darkness and barely through magical darkness', 'pathfinder2e-darkvision', ['bright', 'bright', 'bright', 'dim']],
        ['a sense that only lets the eyes see invisible things perceives nothing by itself', 'dnd5e-see-invisibility', [null, null, null, null]],
        ['Pathfinder greater darkvision sees through magical darkness too', 'pathfinder2e-greater-darkvision', ['bright', 'bright', 'bright', 'bright']],
        ['Old-School Essentials infravision works only in darkness', 'ose-infravision', [null, null, 'dim', null]],
        ['Shadowdark\'s darkness-adapted beings see in light and darkness', 'shadowdark-darkness-adapted', ['bright', 'bright', 'bright', null]],
        ['the generic darkvision sees darkness as dim and leaves dim light as it is, as darkvision did before senses', 'darkvision', ['bright', 'dim', 'dim', null]],
      ] as const) {
        expect(perceived(id)).toEqual(expected);
      }
    });
  });
});

it('parseSenseDefinitions', () => {
  // reads anything that is not a list as no senses of its own
  {
    for (const raw of [undefined, null, 'darkvision', {}, 5]) expect(parseSenseDefinitions(raw)).toBeUndefined();
    expect(parseSenseDefinitions([])).toEqual([]);
  }

  // keeps a valid sense as it is, without fields it does not know
  {
    expect(parseSenseDefinitions([{ ...valid, addedLater: true, sees: { ...valid.sees, twilight: 'normal' } }])).toEqual([valid]);
  }

  // drops a sense without an id or a name, and one whose id repeats; the others stay
  {
    const parsed = parseSenseDefinitions([
      { ...valid, id: '' }, { ...valid, id: 7 }, { ...valid, name: '  ' }, 'garbage', null,
      { ...valid, name: '  Witch sight ' }, { ...valid, name: 'Second with the same id' }, { ...valid, id: 'home-2' },
    ]);
    expect(parsed?.map((sense) => [sense.id, sense.name])).toEqual([['home-1', 'Witch sight'], ['home-2', 'Witch sight']]);
  }

  // replaces each unusable field with the value that shows the players less
  {
    const [sense] = parseSenseDefinitions([{
      id: 'x', name: 'X', description: 5, lineOfSight: 'no', sees: { bright: 'as-dim', dim: 'monochrome', dark: 'normal' },
      look: 'sepia', reveals: 'everything', precise: 'yes', seesInvisible: 1, worksWhileBlinded: 'true', range: 'far',
      defaultRange: -5, ignores: 'burrowing', role: 'blindsight',
    }])!;
    expect(sense).toEqual({
      id: 'x', name: 'X', description: '', lineOfSight: true, sees: { bright: 'none', dim: 'none', dark: 'none', magicalDark: 'none' },
      look: 'colour', reveals: 'creatures', precise: false, seesInvisible: false, worksWhileBlinded: false, range: 'required',
    });
  }

  // reads a sense with nothing but id and name as one that perceives nothing
  {
    expect(parseSenseDefinitions([{ id: 'x', name: 'X' }])?.[0]?.sees).toEqual({ bright: 'none', dim: 'none', dark: 'none', magicalDark: 'none' });
  }

  // takes each light level only in a way that level can be seen
  {
    const sees = (raw: Record<string, string>): SenseDefinition['sees'] => parseSenseDefinitions([{ id: 'x', name: 'X', sees: raw }])![0]!.sees;
    expect(sees({ bright: 'normal', dim: 'normal', dark: 'as-dim', magicalDark: 'as-dim' })).toEqual({ bright: 'normal', dim: 'normal', dark: 'as-dim', magicalDark: 'as-dim' });
    expect(sees({ bright: 'as-bright', dim: 'as-bright', dark: 'as-bright', magicalDark: 'as-bright' })).toEqual({ bright: 'none', dim: 'as-bright', dark: 'as-bright', magicalDark: 'as-bright' });
    expect(sees({ bright: 'none', dim: 'as-dim', dark: 'normal', magicalDark: 'normal' })).toEqual({ bright: 'none', dim: 'none', dark: 'none', magicalDark: 'none' });
  }

  // drops a sense with a blank id or the id of normal sight
  {
    expect(parseSenseDefinitions([{ ...valid, id: '   ' }, { ...valid, id: 'sight' }, { ...valid, id: 'sight-2' }])?.map((sense) => sense.id)).toEqual(['sight-2']);
  }

  // lets only the first sense stand for old darkvision or tremorsense numbers
  {
    const parsed = parseSenseDefinitions([
      { ...valid, id: 'a' }, { ...valid, id: 'b' }, { ...valid, id: 'c', role: 'tremorsense' }, { ...valid, id: 'd', role: 'tremorsense' },
    ]);
    expect(parsed?.map((sense) => [sense.id, sense.role])).toEqual([['a', 'darkvision'], ['b', undefined], ['c', 'tremorsense'], ['d', undefined]]);
  }

  // reads a sense that lets the eyes see invisible things as one that perceives nothing itself
  {
    const [sense] = parseSenseDefinitions([{ ...valid, id: 'm', name: 'Second sight', grants: 'see-invisible' }])!;
    expect(sense).toEqual({
      id: 'm', name: 'Second sight', description: valid.description, grants: 'see-invisible', lineOfSight: true,
      sees: { bright: 'none', dim: 'none', dark: 'none', magicalDark: 'none' }, look: 'colour', reveals: 'creatures', precise: false,
      seesInvisible: false, worksWhileBlinded: false, range: 'unlimited',
    });
    expect(parseSenseDefinitions([{ ...valid, grants: 'see-everything' }])).toEqual([valid]);
  }

  // never lets a sense that walls do not stop show the map: it senses creatures only
  {
    const through = parseSenseDefinitions([{ ...valid, lineOfSight: false }, { ...valid, id: 'b', lineOfSight: false, reveals: 'creatures' }, { ...valid, id: 'c' }])!;
    expect(through.map((sense) => [sense.lineOfSight, sense.reveals])).toEqual([[false, 'creatures'], [false, 'creatures'], [true, 'all']]);
  }

  // keeps a default distance only when it is above 0
  {
    const defaults = parseSenseDefinitions([0, -1, Number.NaN, Infinity, '60', 45].map((defaultRange, i) => ({ id: `s${i}`, name: 'S', defaultRange })));
    expect(defaults?.map((sense) => sense.defaultRange)).toEqual([undefined, undefined, undefined, undefined, undefined, 45]);
  }
});

it('parseTokenSenses', () => {
  // reads anything that is not a list as no senses set
  {
    for (const raw of [undefined, null, 'darkvision', {}]) expect(parseTokenSenses(raw)).toBeUndefined();
    expect(parseTokenSenses([])).toEqual([]);
  }

  // keeps ids with distances above 0, drops unusable entries and distances, and keeps the first of a repeated id
  {
    expect(parseTokenSenses([
      { id: 'darkvision', range: 60 }, { id: 'low-light-vision' }, { id: 'blindsight', range: 0 }, { id: 'tremorsense', range: '30' },
      { id: 'darkvision', range: 120 }, { range: 30 }, { id: '' }, 'truesight', null, { id: 'home', range: 10, other: true },
    ])).toEqual([
      { id: 'darkvision', range: 60 }, { id: 'low-light-vision' }, { id: 'blindsight' }, { id: 'tremorsense' }, { id: 'home', range: 10 },
    ]);
  }

  // drops senses the collection does not have once its senses are known; the generic ones are always known
  {
    const raw = [{ id: 'dnd5e-darkvision', range: 60 }, { id: 'pathfinder2e-scent', range: 30 }, { id: 'blindsight', range: 10 }, { id: 'made-up' }];
    expect(parseTokenSenses(raw, BUILT_IN_SENSES['builtin:dnd5e'])).toEqual([{ id: 'dnd5e-darkvision', range: 60 }, { id: 'blindsight', range: 10 }]);
    expect(parseTokenSenses(raw, [])).toEqual([{ id: 'blindsight', range: 10 }]);
    expect(parseTokenSenses(raw)).toHaveLength(4);
  }
});

it('default vision with senses', () => {
  // keeps the senses beside the other fields
  {
    expect(parseVisionDefaults({ range: 60, senses: [{ id: 'darkvision', range: 60 }, { id: 'low-light-vision', range: -1 }] }))
      .toEqual({ range: 60, senses: [{ id: 'darkvision', range: 60 }, { id: 'low-light-vision' }] });
  }

  // keeps unknown sense ids while the collection is not known, and drops them once it is
  {
    const raw = { senses: [{ id: 'dnd5e-truesight', range: 120 }, { id: 'pathfinder2e-scent', range: 30 }] };
    expect(parseVisionDefaults(raw)?.senses).toHaveLength(2);
    expect(parseVisionDefaults(raw, BUILT_IN_SENSES['builtin:dnd5e'])).toEqual({ senses: [{ id: 'dnd5e-truesight', range: 120 }] });
    expect(parseVisionDefaults(raw, [])).toBeUndefined();
  }

  // is no default when the list of senses is empty or unreadable
  {
    expect(parseVisionDefaults({ senses: [] })).toBeUndefined();
    expect(parseVisionDefaults({ senses: 'darkvision' })).toBeUndefined();
    expect(hasVisionDefaults({ senses: [] })).toBe(false);
    expect(hasVisionDefaults({ senses: [{ id: 'darkvision', range: 60 }] })).toBe(true);
  }

  // lets a list of senses, even an empty one, replace the old fields, as it does on a token
  {
    expect(parseVisionDefaults({ darkvision: 60, tremorsense: 30, senses: [] })).toBeUndefined();
    expect(parseVisionDefaults({ darkvision: 60, range: 120, senses: [] })).toEqual({ range: 120 });
    expect(parseVisionDefaults({ darkvision: 60, senses: [{ id: 'blindsight', range: 10 }] })).toEqual({ senses: [{ id: 'blindsight', range: 10 }] });
    expect(parseVisionDefaults({ darkvision: 60, senses: 'none' })).toEqual({ darkvision: 60 });
    expect(hasVisionDefaults({ darkvision: 60, senses: [] })).toBe(false);
    expect(sameVisionDefaults({ darkvision: 60, senses: [] }, undefined)).toBe(true);
    expect(sameVisionDefaults({ darkvision: 60, senses: [] }, { darkvision: 60 })).toBe(false);
  }

  // compares senses by id and distance, whatever their order; none and an empty list are the same
  {
    const senses = [{ id: 'darkvision', range: 60 }, { id: 'low-light-vision' }];
    expect(sameVisionDefaults({ senses }, { senses: [...senses].reverse() })).toBe(true);
    expect(sameVisionDefaults({ senses }, { senses: [{ id: 'darkvision', range: 30 }, { id: 'low-light-vision' }] })).toBe(false);
    expect(sameVisionDefaults({ senses }, { senses: [{ id: 'darkvision', range: 60 }] })).toBe(false);
    expect(sameVisionDefaults({ senses }, { senses: [{ id: 'darkvision', range: 60 }, { id: 'low-light-vision', range: 60 }] })).toBe(false);
    expect(sameVisionDefaults({ senses: [] }, undefined)).toBe(true);
    expect(sameVisionDefaults({ senses: [] }, {})).toBe(true);
    expect(sameVisionDefaults({ senses }, undefined)).toBe(false);
    expect(sameVisionDefaults({ darkvision: 60 }, { senses: [{ id: 'darkvision', range: 60 }] })).toBe(false);
  }
});
