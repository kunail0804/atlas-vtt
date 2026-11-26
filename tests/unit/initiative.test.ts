import { describe, expect, it, afterEach, vi } from 'vitest';
import { BUILT_IN_SYSTEM_PRESETS } from '../../src/app/gameSystems/builtInPresets';
import { DEFAULT_INITIATIVE_RULES, collectionInitiativeRules, isValidInitiativeRules, parseInitiativeRules, sameInitiativeRules, savedInitiativeRules } from '../../src/app/gameSystems/initiativeRules';
import { parseUserPreset } from '../../src/app/gameSystems/presetValidation';
import { sameSystemRules, vanillaSystemSettings } from '../../src/app/gameSystems/systemRules';
import { sideOf } from '../../src/app/initiative/sides';
import { sidesOfRules } from '../../src/app/gameSystems/initiativeSideRules';
import type { InitiativeRules } from '../../src/app/types/initiativeRulesTypes';
import { isSameAsTyped } from '../../src/app/gameSystems/rulesView';
import { BUILT_IN_TEMPLATES } from '../../src/app/statblocks/presets';
import { produce } from 'immer';
import { createInitiativeActions } from '../../src/app/stores/initiativeSlice';
import { createDefaultInitiativeState, type InitiativeEntry } from '../../src/app/types/initiativeTypes';
import type { TokenEntity } from '../../src/app/types';
import { appliedRules } from '../helpers/appliedRules';
import { givenTokens } from '../../src/app/campaigns/players/givenTokens';
import type { CampaignPlayer } from '../../src/app/campaigns/players/playersFile';
import { KnownPlayerTokens, type PlayerTokenFacts } from '../../src/app/characters/knownPlayerTokens';
import { playerTokensRevision, setPlayerTokenSource, subscribePlayerTokens } from '../../src/app/characters/playerTokens';
import { cardGroupOf } from '../../src/app/initiative/cardGroups';
import { trackerSegments } from '../../src/app/initiative/trackerSegments';
import { turnTokenIds } from '../../src/app/initiative/turnHolders';
import type { TokenAsset } from '../../src/app/services/AssetService';
import { entryTokenOf } from '../../src/app/services/playerInitiativeList';
import { createViewAtlasStore } from '../../src/app/storeFactory';
import { rollInitiativeDice } from '../../src/app/initiative/initiativeDice';
import { createInMemoryApp } from '../mocks/inMemoryVault';

const preset = (name: string): (typeof BUILT_IN_SYSTEM_PRESETS)[number] => BUILT_IN_SYSTEM_PRESETS.find((p) => p.name === name)!;
const SIDES: InitiativeRules = { mode: 'sides', roll: '1d20', firstSide: 'players' };

function cairnGrid(): object {
  return preset('Cairn').rules.gridDefaults;
}

const D20: InitiativeRules = { mode: 'turn-order', roll: '1d20', firstSide: 'players' };
const templateOf = (id: string) => BUILT_IN_TEMPLATES.find((t) => t.id === id)!.template;
const TURN_ORDER: InitiativeRules = { mode: 'turn-order', roll: '1d20', firstSide: 'players' };

function fight(tokenIds: string[] = ['hero', 'goblin', 'rat']): ReturnType<typeof createViewAtlasStore> {
  const { app } = createInMemoryApp();
  const store = createViewAtlasStore(app, `turns-${Math.random()}`);
  store.setState({ persistenceEnabled: false });
  for (const tokenId of tokenIds) {
    store.getState().addToInitiative({ tokenId, name: tokenId, initiative: 0, initiativeModifier: 0, imagePath: '', isNPC: true });
  }
  return store;
}

const turn = (store: ReturnType<typeof createViewAtlasStore>): [number, string | undefined] =>
  [store.getState().initiative.round, store.getState().initiative.sides?.active];

describe('initiative rules of a collection', () => {
  it('is a d20 each, highest first, without a game system', () => {
    expect(collectionInitiativeRules({}, BUILT_IN_SYSTEM_PRESETS)).toEqual(DEFAULT_INITIATIVE_RULES);
    expect(DEFAULT_INITIATIVE_RULES).toMatchObject({ mode: 'turn-order', roll: '1d20' });
  });

  it('takes its preset\'s rules until it has its own: Cairn runs by sides, players first', () => {
    const cairn = preset('Cairn');
    expect(collectionInitiativeRules({ systemPresetId: cairn.id }, BUILT_IN_SYSTEM_PRESETS)).toEqual(SIDES);
    const own: InitiativeRules = { mode: 'turn-order', roll: '2d6', firstSide: 'opponents' };
    expect(collectionInitiativeRules({ systemPresetId: cairn.id, initiative: own }, BUILT_IN_SYSTEM_PRESETS)).toEqual(own);
  });

  it('rolls a d10 in Cyberpunk RED and a d20 in every other built-in turn order', () => {
    const rolls = Object.fromEntries(BUILT_IN_SYSTEM_PRESETS.map((p) => [p.name, collectionInitiativeRules({ systemPresetId: p.id }, BUILT_IN_SYSTEM_PRESETS)]));
    expect(rolls['Cyberpunk RED']).toMatchObject({ mode: 'turn-order', roll: '1d10' });
    expect(Object.entries(rolls).filter(([, rules]) => rules.mode === 'sides').map(([name]) => name)).toEqual(['Cairn', 'Old-School Essentials']);
  });

  it('reads stored rules that are none as unset, so the preset decides', () => {
    for (const raw of [null, 'sides', { mode: 'sides' }, { mode: 'teams', roll: '1d20', firstSide: 'players' }, { mode: 'sides', roll: 'd', firstSide: 'players' }, { mode: 'sides', roll: '1d20', firstSide: 'gm' }]) {
      expect(parseInitiativeRules(raw)).toBeUndefined();
    }
    expect(parseInitiativeRules({ mode: 'sides', roll: ' 1d6 ', firstSide: 'opponents', extra: 1 })).toEqual({ mode: 'sides', roll: '1d6', firstSide: 'opponents' });
    expect(collectionInitiativeRules({ systemPresetId: preset('Cairn').id, initiative: { mode: 'teams' } }, BUILT_IN_SYSTEM_PRESETS)).toEqual(SIDES);
  });

  it('cannot be saved with half a roll in turn order; by sides the roll does not matter and is stored as a d20', () => {
    expect(isValidInitiativeRules({ ...SIDES, mode: 'turn-order', roll: '1d' })).toBe(false);
    expect(isValidInitiativeRules({ ...SIDES, roll: '1d' })).toBe(true);
    expect(savedInitiativeRules({ ...SIDES, roll: '1d' })).toEqual(SIDES);
    expect(savedInitiativeRules({ ...SIDES, roll: ' 2d6 ' })).toEqual({ ...SIDES, roll: '2d6' });
  });

  it('compares unset rules as the default', () => {
    expect(sameInitiativeRules(undefined, { mode: 'turn-order', roll: ' 1D20', firstSide: 'players' })).toBe(true);
    expect(sameInitiativeRules(undefined, SIDES)).toBe(false);
  });
});

describe('initiative rules and game system presets', () => {
  it('leaves a collection set from a preset without rules of its own, and counts it as unedited', () => {
    const cairn = preset('Cairn');
    const applied = appliedRules(cairn);
    expect(applied).not.toHaveProperty('initiative');
    expect(sameSystemRules(cairn.rules, applied)).toBe(true);
    expect(sameSystemRules(cairn.rules, { ...applied, initiative: SIDES })).toBe(true);
    expect(sameSystemRules(cairn.rules, { ...applied, initiative: { ...SIDES, mode: 'turn-order' } })).toBe(false);
  });

  it('clears a collection\'s own rules when it loses its game system', () => {
    expect(vanillaSystemSettings()).toHaveProperty('initiative', undefined);
  });

  it('keeps the rules of a user preset, and drops ones that are none', () => {
    const stored = { id: 'mine', name: 'Mine', rules: { gridDefaults: cairnGrid(), conditions: [], initiative: SIDES } };
    expect(parseUserPreset(stored)?.rules.initiative).toEqual(SIDES);
    expect(parseUserPreset({ ...stored, rules: { ...stored.rules, initiative: { mode: 'teams' } } })?.rules).not.toHaveProperty('initiative');
  });
});

describe('the side a token fights on', () => {
  it('is the one the GM gave it, else the players\' for a token that sees, else the opponents\'', () => {
    expect(sideOf(undefined)).toBe('opponents');
    expect(sideOf({})).toBe('opponents');
    expect(sideOf({ vision: { enabled: true } })).toBe('players');
    expect(sideOf({ vision: { enabled: true }, side: 'opponents' })).toBe('opponents');
    expect(sideOf({ side: 'players' })).toBe('players');
    // A map file edited by hand
    expect(sideOf({ side: 'gm' as never })).toBe('opponents');
  });

  it('lists the sides in the order they act', () => {
    expect(sidesOfRules({ firstSide: 'opponents' }).map((side) => side.id)).toEqual(['opponents', 'players']);
  });
});

it('where the initiative modifier is read from', () => {
  // is read trimmed, with the ability score switch only where it is on; a blank or no field is none
  {
    expect(parseInitiativeRules({ ...D20, modifier: { field: ' combat.init ' } })).toEqual({ ...D20, modifier: { field: 'combat.init' } });
    expect(parseInitiativeRules({ ...D20, modifier: { field: 'stats.1', abilityScore: true } }))
      .toEqual({ ...D20, modifier: { field: 'stats.1', abilityScore: true } });
    expect(parseInitiativeRules({ ...D20, modifier: { field: 'dex', abilityScore: 'yes' } })).toEqual({ ...D20, modifier: { field: 'dex' } });
    expect(parseInitiativeRules({ ...D20, modifier: { field: '  ' } })).toEqual(D20);
    expect(parseInitiativeRules({ ...D20, modifier: 'initiative' })).toEqual(D20);
    expect(parseInitiativeRules({ ...D20, modifierFallback: { field: 'stats.1', abilityScore: true } }))
      .toEqual({ ...D20, modifierFallback: { field: 'stats.1', abilityScore: true } });
  }

  // round-trips through saving: stored trimmed, a blank field not stored at all
  {
    const saved = savedInitiativeRules({ ...D20, modifier: { field: ' dex ', abilityScore: true }, modifierFallback: { field: 'x' } });
    expect(saved).toEqual({ ...D20, modifier: { field: 'dex', abilityScore: true }, modifierFallback: { field: 'x' } });
    expect(parseInitiativeRules(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
    expect(savedInitiativeRules({ ...D20, modifier: { field: '' } })).not.toHaveProperty('modifier');
  }

  // makes rules differ by field, by the ability score switch and by the fallback
  {
    expect(sameInitiativeRules(D20, { ...D20, modifier: { field: 'initiative' } })).toBe(false);
    expect(sameInitiativeRules({ ...D20, modifier: { field: 'init ' } }, { ...D20, modifier: { field: 'init' } })).toBe(true);
    expect(sameInitiativeRules({ ...D20, modifier: { field: 'dex' } }, { ...D20, modifier: { field: 'dex', abilityScore: true } })).toBe(false);
    expect(sameInitiativeRules(D20, { ...D20, modifierFallback: { field: 'stats.1' } })).toBe(false);
    expect(sameInitiativeRules(D20, { ...D20, modifier: { field: '' } })).toBe(true);
    expect(isSameAsTyped({ ...D20, modifier: { field: 'init' } }, D20)).toBe(false);
    expect(isSameAsTyped({ ...D20, modifier: { field: 'dex', abilityScore: true } }, { ...D20, modifier: { field: 'dex' } })).toBe(false);
    expect(isSameAsTyped({ ...D20, modifier: { field: 'init' } }, { ...D20, modifier: { field: 'init' } })).toBe(true);
  }

  // is kept by a user preset
  {
    const initiative: InitiativeRules = { ...D20, modifier: { field: 'dex', abilityScore: true }, modifierFallback: { field: 'init' } };
    const parsed = parseUserPreset({ id: 'p', name: 'Home', builtIn: false, rules: { ...preset('D&D 5e').rules, initiative } });
    expect(parsed?.rules.initiative).toEqual(initiative);
  }

  // is Initiative, else DEX read as an ability score, in D&D 5e
  {
    const rules = collectionInitiativeRules({ systemPresetId: preset('D&D 5e').id }, BUILT_IN_SYSTEM_PRESETS);
    expect(rules.modifier).toEqual({ field: 'initiative' });
    expect(rules.modifierFallback).toEqual({ field: 'stats.1', abilityScore: true });
    // The templates of its roles keep both there: Initiative, and DEX in the second slot of the abilities
    for (const role of preset('D&D 5e').rules.statblockRoles ?? []) {
      const template = templateOf(role.templateId);
      expect(template.fields.find((f) => f.key === 'initiative')?.meaning).toBe('initiative');
      const abilities = template.fields.find((f) => f.key === 'stats');
      expect(abilities?.type === 'scores' && abilities.slots?.[1]).toMatch(/^dex$/i);
    }
  }

  // is Initiative in Pathfinder 2e, whose template has that field
  {
    const system = preset('Pathfinder 2e');
    expect(collectionInitiativeRules({ systemPresetId: system.id }, BUILT_IN_SYSTEM_PRESETS).modifier).toEqual({ field: 'initiative' });
    for (const role of system.rules.statblockRoles ?? []) {
      expect(templateOf(role.templateId).fields.find((f) => f.key === 'initiative')?.meaning).toBe('initiative');
    }
  }

  // counts a collection that follows its preset as unedited, and one with another source as edited
  {
    const system = preset('D&D 5e');
    const own = system.rules.initiative!;
    expect(sameSystemRules(system.rules, { ...system.rules })).toBe(true);
    expect(sameSystemRules(system.rules, { ...system.rules, initiative: { ...own, modifier: { field: 'init' } } })).toBe(false);
    expect(sameSystemRules(system.rules, { ...system.rules, initiative: { ...own, modifier: { field: 'initiative', abilityScore: true } } })).toBe(false);
  }
});

describe('initiative roll inputs', () => {
  function entry(id: string, modifier = 0): InitiativeEntry {
    return { id, tokenId: id, name: id, initiative: 0, initiativeModifier: modifier, imagePath: '', isNPC: false, order: 0, isActive: false };
  }

  function setup(entries = [entry('a', 2), entry('b', -1)], values = [0, 0.99, 0.5, 0.25]) {
    let state = { initiative: { ...createDefaultInitiativeState(), entries }, initiativeTrackerOpen: false, objects: { tokens: {} as Record<string, TokenEntity> } };
    let insideRecipe = false;
    let index = 0;
    const random = vi.fn(() => {
      expect(insideRecipe, 'dice must be generated before the store recipe runs').toBe(false);
      return values[index++ % values.length]!;
    });
    const set = vi.fn<Parameters<typeof createInitiativeActions>[0]>((recipe) => {
      insideRecipe = true;
      try { state = produce(state, recipe); } finally { insideRecipe = false; }
    });
    const get = (): typeof state => state;
    const actions = createInitiativeActions(set, 'initiative-inputs', get, random);
    const ambient = vi.spyOn(Math, 'random');
    return { actions, random, set, get, ambient };
  }

  afterEach(() => vi.restoreAllMocks());

  describe('initiative roll inputs', () => {
    it('rolls each die before one store update, adding each modifier once', () => {
      const { actions, random, set, get, ambient } = setup();
      actions.rollAllInitiative('2d6');
      expect(random).toHaveBeenCalledTimes(4);
      expect(ambient).not.toHaveBeenCalled();
      expect(set).toHaveBeenCalledOnce();
      expect(get().initiative.entries.map(e => [e.id, e.initiative, e.order])).toEqual([['a', 9, 0], ['b', 5, 1]]);
    });

    it('sorts descending with stable ties', () => {
      const { actions, set, get } = setup([entry('a'), entry('b'), entry('c')], [0, 0.99, 0.99]);
      set.mockClear();
      actions.rollAllInitiative('d6');
      expect(set).toHaveBeenCalledOnce();
      expect(get().initiative.entries.map(e => [e.id, e.initiative, e.order])).toEqual([['b', 6, 0], ['c', 6, 1], ['a', 1, 2]]);
    });

    it('rolls just the named entry and reorders during an active fight', () => {
      const { actions, random, set, get } = setup();
      actions.startCombat();
      set.mockClear();
      actions.rollEntryInitiative('b', '2d6');
      expect(random).toHaveBeenCalledTimes(2);
      expect(set).toHaveBeenCalledOnce();
      expect(get().initiative.entries.map(e => [e.id, e.initiative])).toEqual([['b', 6], ['a', 0]]);
      expect(get().initiative.isActive).toBe(true);
    });

    it('does not generate dice for a missing entry or an empty tracker', () => {
      const { actions, random } = setup([]);
      actions.rollEntryInitiative('missing');
      actions.rollAllInitiative();
      expect(random).not.toHaveBeenCalled();
    });
  });

  describe('initiative rolls with statblock modifiers', () => {
    it('adds the statblock\'s modifier where the entry has none of its own, and keeps a hand-set one', () => {
      const { actions, get } = setup([entry('own', 2), entry('linked'), entry('plain')], [0.5]);
      actions.rollAllInitiative('1d20', new Map([['own', 9], ['linked', 5]]));
      expect(get().initiative.entries.map(e => [e.id, e.initiative])).toEqual([['linked', 16], ['own', 13], ['plain', 11]]);
    });

    it('rolls one entry with its statblock\'s modifier, and keeps its own where the statblock gives none', () => {
      const { actions, get } = setup([entry('linked'), entry('own', -1)], [0.5]);
      actions.rollEntryInitiative('linked', '1d20', 4);
      actions.rollEntryInitiative('own', '1d20', null);
      expect(get().initiative.entries.map(e => [e.id, e.initiative])).toEqual([['linked', 15], ['own', 10]]);
    });

    it('never writes the statblock\'s modifier onto the entry', () => {
      const { actions, get } = setup([entry('linked')], [0.5]);
      actions.rollAllInitiative('1d20', new Map([['linked', 5]]));
      expect(get().initiative.entries[0]!.initiativeModifier).toBe(0);
    });
  });

  describe('a modifier the GM set on an entry', () => {
    it('wins over the statblock\'s, an explicit 0 too, and a cleared one lets the statblock count again', () => {
      const { actions, get } = setup([{ ...entry('zero'), modifierByHand: true }], [0.5]);
      actions.rollAllInitiative('1d20', new Map([['zero', 5]]));
      expect(get().initiative.entries[0]!.initiative).toBe(11);
      actions.updateInitiativeEntry('zero', { initiativeModifier: 0, modifierByHand: undefined });
      actions.rollAllInitiative('1d20', new Map([['zero', 5]]));
      expect(get().initiative.entries[0]!.initiative).toBe(16);
    });
  });
});

describe('the players\' side', () => {
  const record = (id: string, playerCharacter?: true): TokenAsset => ({
    id, type: 'token', name: id, imagePath: `art/${id}.webp`, tags: [], collection: 'Fen', createdAt: 1, modifiedAt: 1, ...(playerCharacter && { playerCharacter }),
  });
  const token = (id: string, changes: Partial<TokenEntity> = {}): TokenEntity => ({ id, kind: 'token', x: 0, y: 0, imagePath: `art/${id}.webp`, assetId: id, ...changes } as TokenEntity);
  /** A token placed from no library token, or before tokens named theirs. */
  const loose = (id: string): TokenEntity => ({ id, kind: 'token', x: 0, y: 0, imagePath: `art/${id}.webp` });
  const entry = (tokenId: string, order: number): InitiativeEntry => ({
    id: `e-${tokenId}`, tokenId, name: tokenId, initiative: 0, initiativeModifier: 0, imagePath: `art/${tokenId}.webp`, isActive: false, isNPC: true, order,
  });
  const player = (id: string, characters: string[]): CampaignPlayer => ({ id, name: id, code: '123456', characters });

  /** The app's source as the plugin sets it up, over a library and what a played campaign's players were given. */
  function known(facts: Partial<PlayerTokenFacts> & { library: PlayerTokenFacts['library'] }): KnownPlayerTokens {
    const source = new KnownPlayerTokens({ given: () => null, ...facts });
    setPlayerTokenSource(source);
    return source;
  }

  afterEach(() => setPlayerTokenSource(null));

  describe('the side of a token nobody gave one', () => {
    it('is the players\' for a player character of the library, whether or not its token sees', () => {
      known({ library: () => [record('ranger', true), record('wolf')] });
      expect(sideOf(token('ranger'))).toBe('players');
      expect(sideOf(token('ranger', { vision: { enabled: false } }))).toBe('players');
      expect(sideOf(token('wolf'))).toBe('opponents');
      expect(sideOf(token('wolf', { vision: { enabled: true } }))).toBe('players');
    });

    it('finds the character of a token placed before tokens named their library token by its art', () => {
      known({ library: () => [record('ranger', true)] });
      expect(sideOf(loose('ranger'))).toBe('players');
      expect(sideOf(loose('other'))).toBe('opponents');
    });

    it('is the players\' for what a player of the played campaign was given, and only while it is played', () => {
      let played = true;
      const given = givenTokens([player('ada', ['bard'])], { owners: { loose: 'ada', stray: 'nobody' }, playerTokens: {} });
      const source = known({ library: () => [record('bard'), record('wolf')], given: () => (played ? given : null) });
      expect(sideOf(token('on-another-scene', { assetId: 'bard' }))).toBe('players');
      expect(sideOf(loose('loose'))).toBe('players');
      expect(sideOf(loose('stray'))).toBe('opponents');
      expect(sideOf(token('wolf'))).toBe('opponents');
      played = false;
      source.changed();
      expect(sideOf(token('on-another-scene', { assetId: 'bard' }))).toBe('opponents');
    });

    it('never wins over the side the GM gave the token', () => {
      known({ library: () => [record('ranger', true)] });
      expect(sideOf(token('ranger', { side: 'opponents' }))).toBe('opponents');
      expect(sideOf(token('ranger', { side: 'side-abc123' }), ['players', 'opponents', 'side-abc123'])).toBe('side-abc123');
      // A side the fight does not know falls back to the default
      expect(sideOf(token('ranger', { side: 'side-abc123' }))).toBe('players');
    });

    it('is the opponents\' for every token that does not see while nothing knows the library', () => {
      expect(sideOf(token('ranger'))).toBe('opponents');
    });
  });

  describe('everything that reads a side', () => {
    const tokens = { ranger: token('ranger'), wolf: token('wolf') };
    const entries = [entry('wolf', 0), entry('ranger', 1)];
    const sides = (['players', 'opponents'] as const).map((id) => ({ id, name: id, roll: null, active: false }));

    it('gives a player character without vision the same side: both lists, the turn and the deal', () => {
      known({ library: () => [record('ranger', true), record('wolf')] });
      const groups = trackerSegments(entries, tokens, { bySides: true, sides, fightRuns: false, round: 0, fromTurn: false })
        .flatMap((segment) => (segment.kind === 'round' ? [] : [[segment.side?.id, segment.items.map((item) => item.tokenId)]]));
      expect(groups).toEqual([['players', ['ranger']], ['opponents', ['wolf']]]);
      expect([entryTokenOf(tokens.ranger, []).side, entryTokenOf(tokens.wolf, []).side]).toEqual(['players', 'opponents']);
      const fight = { ...createDefaultInitiativeState(), isActive: true, round: 1, entries, sides: { first: 'players', active: 'players' } as const };
      expect(turnTokenIds(fight, tokens)).toEqual(['ranger']);
      // Look-alikes share a card only among those who are not the players'
      expect(entries.map(cardGroupOf(tokens, true))).toEqual(['art:art/wolf.webp', 'entry:e-ranger']);
    });
  });

  describe('what knows the players\' tokens', () => {
    it('remembers its answers until it is told the library changed, and tells whoever listens', () => {
      let reads = 0;
      let library = [record('ranger')];
      const source = known({ library: () => { reads++; return library; } });
      let heard = 0;
      const stop = subscribePlayerTokens(() => heard++);
      const before = playerTokensRevision();
      expect([sideOf(token('ranger')), sideOf(token('ranger')), reads]).toEqual(['opponents', 'opponents', 1]);
      library = [record('ranger', true)];
      expect(sideOf(token('ranger'))).toBe('opponents');
      source.changed();
      expect([sideOf(token('ranger')), reads, heard]).toEqual(['players', 2, 1]);
      expect(playerTokensRevision()).toBeGreaterThan(before);
      stop();
      source.changed();
      expect(heard).toBe(1);
    });

    it('reads who was given what from the campaign\'s players, leaving out a token whose owner is no player of it', () => {
      const given = givenTokens([player('ada', ['bard', 'bear']), player('bo', [])], { owners: { loose: 'bo', stray: 'gone' }, playerTokens: {} });
      expect([[...given.characters], [...given.tokens]]).toEqual([['bard', 'bear'], ['loose']]);
    });
  });
});

describe('a fight by sides', () => {
  it('starts with the first side in round 1 and marks no single combatant', () => {
    const store = fight();
    store.getState().startCombat({ ...SIDES, firstSide: 'opponents' });
    expect(store.getState().initiative).toMatchObject({ isActive: true, round: 1, sides: { first: 'opponents', active: 'opponents' } });
    expect(store.getState().initiative.entries.some((entry) => entry.isActive)).toBe(false);
  });

  it('gives the turn to the other side, then starts the next round with the first', () => {
    const store = fight();
    store.getState().startCombat(SIDES);
    const seen = [turn(store)];
    for (let step = 0; step < 3; step++) { store.getState().nextTurn(); seen.push(turn(store)); }
    expect(seen).toEqual([[1, 'players'], [1, 'opponents'], [2, 'players'], [2, 'opponents']]);
  });

  it('steps back the same way and stops at the start of round 1', () => {
    const store = fight();
    store.getState().startCombat(SIDES);
    store.getState().nextTurn();
    store.getState().nextTurn();
    const seen = [turn(store)];
    for (let step = 0; step < 3; step++) { store.getState().previousTurn(); seen.push(turn(store)); }
    expect(seen).toEqual([[2, 'players'], [1, 'opponents'], [1, 'players'], [1, 'players']]);
  });

  it('lets a combatant sit a round out, until the round ends', () => {
    const store = fight();
    store.getState().startCombat(SIDES);
    const hero = store.getState().initiative.entries[0]!.id;
    store.getState().setInitiativeSitsOut(hero, true);
    store.getState().nextTurn();
    expect(store.getState().initiative.entries[0]).toMatchObject({ sitsOut: true });
    store.getState().nextTurn();
    expect(store.getState().initiative.entries[0]).not.toHaveProperty('sitsOut');
  });

  it('ends without a side or anyone sitting out', () => {
    const store = fight();
    store.getState().startCombat(SIDES);
    store.getState().setInitiativeSitsOut(store.getState().initiative.entries[0]!.id, true);
    store.getState().endCombat();
    expect(store.getState().initiative).not.toHaveProperty('sides');
    expect(store.getState().initiative.entries[0]).not.toHaveProperty('sitsOut');
    expect(store.getState().initiative.entries).toHaveLength(3);
  });

  it('keeps the mode it started in: a fight in turn order has no sides', () => {
    const store = fight();
    store.getState().startCombat(SIDES);
    store.getState().endCombat();
    store.getState().startCombat(TURN_ORDER);
    expect(store.getState().initiative).not.toHaveProperty('sides');
    expect(store.getState().initiative.entries.map((entry) => entry.isActive)).toEqual([true, false, false]);
    store.getState().nextTurn();
    expect(store.getState().initiative.entries.map((entry) => entry.isActive)).toEqual([false, true, false]);
  });

  it('starts in turn order when no rules are given, as every caller did before', () => {
    const store = fight();
    store.getState().startCombat();
    expect(store.getState().initiative.entries[0]!.isActive).toBe(true);
  });
});

describe('clearing the initiative', () => {
  it('removes every combatant and ends the fight', () => {
    const store = fight();
    store.getState().startCombat(SIDES);
    store.getState().nextTurn();
    store.getState().resetInitiative();
    expect(store.getState().initiative).toMatchObject({ entries: [], isActive: false, round: 0, currentIndex: -1 });
    expect(store.getState().initiative).not.toHaveProperty('sides');
  });

  it('keeps the tracker open', () => {
    const store = fight();
    store.getState().setInitiativeTrackerOpen(true);
    store.getState().resetInitiative();
    expect(store.getState().initiativeTrackerOpen).toBe(true);
  });
});

describe('rolling initiative', () => {
  afterEach(() => vi.restoreAllMocks());

  it('notifies once for changed rolls and not for unchanged or missing entries', () => {
    const store = fight();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    store.getState().rollAllInitiative();
    expect(changed).toHaveBeenCalledOnce();
    const first = store.getState().initiative.entries[0]!.id;
    store.getState().rollAllInitiative();
    store.getState().rollEntryInitiative(first);
    store.getState().rollEntryInitiative('missing');
    expect(changed).toHaveBeenCalledOnce();
    store.getState().rollEntryInitiative(first, '1d6');
    expect(changed).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('does not notify or draw random values for an empty tracker', () => {
    const store = fight([]);
    const random = vi.spyOn(Math, 'random');
    const changed = vi.fn();
    const unsubscribe = store.subscribe(changed);
    store.getState().rollAllInitiative();
    store.getState().rollEntryInitiative('missing');
    expect(changed).not.toHaveBeenCalled();
    expect(random).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('rolls the collection\'s dice', () => {
    expect(rollInitiativeDice('1d10', () => 0.999)).toBe(10);
    expect(rollInitiativeDice('2d6', () => 0)).toBe(2);
    expect(rollInitiativeDice('2d6', () => 0.999)).toBe(12);
    // A roll that is none falls back to a d20
    expect(rollInitiativeDice('nonsense', () => 0.999)).toBe(20);
  });

  it('rolls them for every combatant, and for one', () => {
    // Entry ids are random too, so the fight is set up first
    const store = fight();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.999);
    store.getState().rollAllInitiative('1d10');
    expect(store.getState().initiative.entries.map((entry) => entry.initiative)).toEqual([10, 10, 10]);
    store.getState().rollEntryInitiative(store.getState().initiative.entries[1]!.id, '1d6');
    expect(store.getState().initiative.entries.map((entry) => entry.initiative)).toEqual([10, 10, 6]);
    store.getState().rollAllInitiative();
    expect(store.getState().initiative.entries.map((entry) => entry.initiative)).toEqual([20, 20, 20]);
    random.mockRestore();
  });
});
