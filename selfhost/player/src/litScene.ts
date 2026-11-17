import { CONDITION_EFFECTS, type SharedLightingScene, type SharedSight, type SharedVision, type SightToken } from '../../../src/app/online/protocol/lighting.ts';
import { parseSenseDefinitions } from '../../../src/app/gameSystems/senseValidation.ts';
import { readEmission } from '../../../src/app/lighting/lightingObjects.ts';
import { readSceneLighting } from '../../../src/app/lighting/sceneLightingOptions.ts';
import type { TokenEntity } from '../../../src/app/types.ts';
import type { ConditionDefinition } from '../../../src/app/types/collectionSettingsTypes.ts';
import type { LightSource, LightZone } from '../../../src/app/types/lightingTypes.ts';
import type { WallSegment } from '../../../src/app/types/wallTypes.ts';
import type { SceneState } from '../../../src/app/vision/sceneModel.ts';
import type { SightRules, TokenSight } from '../../../src/app/vision/sightRules.ts';

/**
 * Where a stand-in token waits when the GM says the players are blind (every vision token hidden):
 * far from any map. Its sight is `pending`, which opens nothing, and it keeps the players' sight
 * from reading "no vision token" as "sees everything the light shows".
 */
const BLIND_STAND_IN = { id: 'blind-stand-in', x: -900_000, y: -900_000 } as const;

/** One condition per effect the GM sends, so the plugin's sight reads a token's effects as it does on the GM's side. */
const EFFECT_CONDITIONS: readonly ConditionDefinition[] = CONDITION_EFFECTS.map((effect) => ({ id: `effect-${effect}`, name: effect, color: '#000000', effect }));

export interface LitScene {
  readonly state: SceneState;
  readonly rules: SightRules;
  /** Game units per cell and world pixels per cell, as the GM's lighting reads them. */
  readonly unitDistance: number;
}

function sightOf(vision: SharedVision): TokenSight {
  return {
    senses: vision.senses.map((sense) => ({ id: sense.id, ...(sense.range === undefined ? {} : { range: sense.range }) })),
    ...(vision.sightRange === undefined ? {} : { sightRange: vision.sightRange }),
    ...(vision.pending === true ? { pending: true } : {}),
  };
}

/** What a lit scene keeps from the GM's `lighting` message, which changes seldom: walls, zones, grid and senses. */
interface SceneParts {
  readonly source: SharedLightingScene;
  readonly walls: Record<string, WallSegment>;
  readonly lightZones: Record<string, LightZone>;
  readonly grid: SceneState['grid'];
  readonly definitions: SightRules['definitions'];
}

function sceneParts(scene: SharedLightingScene): SceneParts {
  const walls: Record<string, WallSegment> = {};
  scene.walls.forEach((wall, index) => {
    const id = `wall-${index}`;
    walls[id] = {
      id, kind: 'wall', type: wall.door === undefined ? 'solid' : 'door', p1: { x: wall.p[0], y: wall.p[1] }, p2: { x: wall.p[2], y: wall.p[3] },
      ...(wall.door === undefined ? {} : { closed: wall.door === 'closed' }),
      ...(wall.direction === undefined ? {} : { direction: wall.direction }),
      ...(wall.blocks === undefined ? {} : { blocks: wall.blocks }),
      ...(wall.limited === true ? { limited: true } : {}),
    };
  });
  const lightZones: Record<string, LightZone> = {};
  scene.zones.forEach((zone, index) => {
    const polygon: { x: number; y: number }[] = [];
    for (let at = 0; at + 1 < zone.polygon.length; at += 2) polygon.push({ x: zone.polygon[at] ?? 0, y: zone.polygon[at + 1] ?? 0 });
    const id = `zone-${index}`;
    lightZones[id] = { id, kind: 'light-zone', polygon, ambient: zone.ambient, ...(zone.colour === undefined ? {} : { ambientColor: zone.colour }) };
  });
  const grid = { enabled: true, size: scene.cellSize, offsetX: 0, offsetY: 0, opacity: 0 };
  return { source: scene, walls, lightZones, grid, definitions: parseSenseDefinitions(scene.senses) ?? [] };
}

/**
 * Objects by id, each made again only when what it is made from (its text) changed, and the record
 * itself the same while every one of them is: the lighting builds anew only what it finds changed
 * by reference (`SceneModelBuilder`), so an object made again is light or sight traced again.
 */
class Kept<T> {
  private texts = new Map<string, string>();
  private record: Record<string, T> = {};

  keep(entries: readonly { readonly id: string; readonly text: string; readonly make: () => T | null }[]): Record<string, T> {
    const texts = new Map<string, string>();
    const record: Record<string, T> = {};
    const order = [...this.texts.keys()];
    let same = true;
    for (const { id, text, make } of entries) {
      const kept = this.texts.get(id) === text ? this.record[id] : undefined;
      const made = kept ?? make();
      if (made === null) continue;
      // Another object, or the same in another place of the order.
      if (kept === undefined || order[texts.size] !== id) same = false;
      texts.set(id, text);
      record[id] = made;
    }
    if (same && texts.size === this.texts.size) return this.record;
    this.texts = texts;
    this.record = record;
    return record;
  }
}

/** A value made again only when its text changed. */
class KeptValue<T> {
  private text: string | null = null;
  private value: T | null = null;

  keep(text: string, make: () => T): T {
    if (this.value === null || text !== this.text) {
      this.text = text;
      this.value = make();
    }
    return this.value;
  }
}

/**
 * The lit scene as the plugin's lighting reads it, rebuilt from the GM's `lighting` and `sight`
 * messages: the inverse of `sharedLightingScene` and `sharedSight` in sceneInputs.ts. Every light
 * and emission goes through Atlas's own readers, so anything it would refuse is left out here too.
 *
 * The GM sends `sight` at every step of a drag, parsed anew: what did not change keeps its object
 * from the last message (walls, zones, lights and tokens that did not move, the rules), so the
 * lighting traces again only the token that moved and what it carries.
 */
export class LitSceneBuilder {
  private parts: SceneParts | null = null;
  private readonly lights = new Kept<LightSource>();
  private readonly tokens = new Kept<TokenEntity>();
  private readonly lighting = new KeptValue<SceneState['lighting']>();
  private readonly held = new KeptValue<SceneState['heldTokens']>();
  private rules = new KeptValue<SightRules>();

  build(scene: SharedLightingScene, sight: SharedSight): LitScene {
    if (this.parts?.source !== scene) {
      this.parts = sceneParts(scene);
      // The rules hold the scene's senses: made again with them.
      this.rules = new KeptValue<SightRules>();
    }
    const parts = this.parts;
    const lights = this.lights.keep(sight.lights.map((light) => ({ id: light.id, text: JSON.stringify(light), make: () => lightOf(light) })));
    const shared = sight.blind === true ? [...sight.tokens, BLIND_TOKEN] : sight.tokens;
    const tokens = this.tokens.keep(shared.map((token) => ({ id: token.id, text: JSON.stringify(token), make: () => tokenOf(token) })));
    const visions = new Map<string, TokenSight>();
    for (const token of shared) if (token.vision !== undefined) visions.set(token.id, sightOf(token.vision));
    if (sight.blind === true) visions.set(BLIND_STAND_IN.id, { senses: [], pending: true });
    const rules = this.rules.keep(JSON.stringify([...visions]), () => ({
      definitions: parts.definitions,
      conditions: EFFECT_CONDITIONS,
      // The GM worked each token's senses out (statblocks included): sight reads them from here alone.
      visionOf: (token) => visions.get(token.id) ?? { senses: [], pending: true },
    }));
    const state: SceneState = {
      objects: { tokens, walls: parts.walls, lights, lightZones: parts.lightZones },
      lighting: this.lighting.keep(JSON.stringify(sight.lighting), () => ({ ...readSceneLighting(sight.lighting), enabled: true })),
      grid: parts.grid,
      heldTokens: this.held.keep(JSON.stringify(sight.held), () => Object.fromEntries(sight.held.map((held) => [held.id, { x: held.x, y: held.y }]))),
    };
    return { state, rules, unitDistance: scene.unitDistance };
  }
}

/** The stand-in's entry, as the GM would send it: it sees, pending, far from any map. */
const BLIND_TOKEN = { ...BLIND_STAND_IN, size: 1, vision: { senses: [], pending: true } } as const satisfies SightToken;

function lightOf(light: SharedSight['lights'][number]): LightSource | null {
  const emission = readEmission(light.emission);
  if (emission === null) return null;
  return {
    id: light.id, kind: 'light', x: light.x, y: light.y, emission,
    ...(light.rotation === undefined ? {} : { rotation: light.rotation }),
    ...(light.activeBelowAmbient === undefined ? {} : { activeBelowAmbient: light.activeBelowAmbient }),
  };
}

function tokenOf(token: SightToken): TokenEntity {
  const emission = token.light === undefined ? null : readEmission(token.light);
  return {
    id: token.id, kind: 'token', imagePath: '', x: token.x, y: token.y, size: token.size,
    ...(token.rotation === undefined ? {} : { rotation: token.rotation }),
    ...(token.vision === undefined ? {} : { vision: { enabled: true, ...(token.vision.angle === undefined ? {} : { angle: token.vision.angle }) } }),
    ...(emission === null ? {} : { light: emission }),
    ...(token.effects === undefined ? {} : { conditions: token.effects.map((effect) => `effect-${effect}`) }),
  };
}
