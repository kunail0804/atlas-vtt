import { CONDITION_EFFECTS, type SharedLightingScene, type SharedSight, type SharedVision } from '../../../src/app/online/protocol/lighting.ts';
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

/**
 * The lit scene as the plugin's lighting reads it, rebuilt from the GM's `lighting` and `sight`
 * messages: the inverse of `sharedLightingScene` and `sharedSight` in sceneInputs.ts. Every light
 * and emission goes through Atlas's own readers, so anything it would refuse is left out here too.
 */
export function litScene(scene: SharedLightingScene, sight: SharedSight): LitScene {
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
  const lights: Record<string, LightSource> = {};
  for (const light of sight.lights) {
    const emission = readEmission(light.emission);
    if (emission === null) continue;
    lights[light.id] = {
      id: light.id, kind: 'light', x: light.x, y: light.y, emission,
      ...(light.rotation === undefined ? {} : { rotation: light.rotation }),
      ...(light.activeBelowAmbient === undefined ? {} : { activeBelowAmbient: light.activeBelowAmbient }),
    };
  }
  const tokens: Record<string, TokenEntity> = {};
  const visions = new Map<string, TokenSight>();
  for (const token of sight.tokens) {
    const emission = token.light === undefined ? null : readEmission(token.light);
    tokens[token.id] = {
      id: token.id, kind: 'token', imagePath: '', x: token.x, y: token.y, size: token.size,
      ...(token.rotation === undefined ? {} : { rotation: token.rotation }),
      ...(token.vision === undefined ? {} : { vision: { enabled: true, ...(token.vision.angle === undefined ? {} : { angle: token.vision.angle }) } }),
      ...(emission === null ? {} : { light: emission }),
      ...(token.effects === undefined ? {} : { conditions: token.effects.map((effect) => `effect-${effect}`) }),
    };
    if (token.vision !== undefined) visions.set(token.id, sightOf(token.vision));
  }
  if (sight.blind === true) {
    tokens[BLIND_STAND_IN.id] = { ...BLIND_STAND_IN, kind: 'token', imagePath: '', size: 1, vision: { enabled: true } };
    visions.set(BLIND_STAND_IN.id, { senses: [], pending: true });
  }
  const heldTokens: Record<string, { x: number; y: number }> = {};
  for (const held of sight.held) heldTokens[held.id] = { x: held.x, y: held.y };
  const state: SceneState = {
    objects: { tokens, walls, lights, lightZones },
    lighting: { ...readSceneLighting(sight.lighting), enabled: true },
    grid: { enabled: true, size: scene.cellSize, offsetX: 0, offsetY: 0, opacity: 0 },
    heldTokens,
  };
  const rules: SightRules = {
    definitions: parseSenseDefinitions(scene.senses) ?? [],
    conditions: EFFECT_CONDITIONS,
    // The GM worked each token's senses out (statblocks included): sight reads them from here alone.
    visionOf: (token) => visions.get(token.id) ?? { senses: [], pending: true },
  };
  return { state, rules, unitDistance: scene.unitDistance };
}
