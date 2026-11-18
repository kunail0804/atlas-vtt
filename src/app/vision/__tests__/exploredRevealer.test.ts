import { describe, expect, it } from 'vitest';
import type { MeasurementSettings } from '../../grid/measurementFormat';
import { exploredRevealerOf, tokensRecordMemory } from '../../lighting/sceneLightingOptions';
import type { SceneLighting } from '../../types/lightingTypes';
import { SceneModelBuilder, type SceneState } from '../sceneModel';
import type { MapBounds } from '../visibility';

const BOUNDS: MapBounds = { width: 600, height: 400 };
const MEASUREMENT: MeasurementSettings = { mode: 'metric', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 90 };
const measurement = (): MeasurementSettings => MEASUREMENT;

const objects: SceneState['objects'] = { tokens: { scout: { id: 'scout', kind: 'token', imagePath: '', x: 100, y: 200, size: 1, vision: { enabled: true, range: 30 } } }, walls: {}, lights: {} };
const grid: SceneState['grid'] = { enabled: true, size: 70, offsetX: 0, offsetY: 0, opacity: 1 };
const heldTokens: SceneState['heldTokens'] = {};

/** A scout who sees a room in daylight; only the lighting differs from one scene to the next, as when the GM changes an option. */
function scene(lighting: SceneLighting): SceneState {
  return { objects, lighting, grid, heldTokens };
}

describe('who reveals explored memory', () => {
  it('is the GM unless the scene says the players do', () => {
    expect(exploredRevealerOf({})).toBe('gm');
    expect(exploredRevealerOf({ exploredBy: 'gm' })).toBe('gm');
    expect(exploredRevealerOf({ exploredBy: 'players' })).toBe('players');
    // A value this version does not know (a hand edit) reads as unset.
    expect(exploredRevealerOf({ exploredBy: 'everyone' as never })).toBe('gm');
    expect(tokensRecordMemory({ exploredBy: 'players' })).toBe(true);
    expect(tokensRecordMemory({ exploredBy: 'players', exploredMemory: false })).toBe(false);
    expect(tokensRecordMemory({})).toBe(false);
  });

  it('gives the memory what tokens see only while the players reveal it, and rebuilds when the GM switches', () => {
    const builder = new SceneModelBuilder();
    const byHand = builder.update(scene({ enabled: true, ambient: 1 }), BOUNDS, measurement);
    expect(byHand.model.sight.regions).toHaveLength(1);
    expect(byHand.model.explored).toBeNull();

    const byPlayers = builder.update(scene({ enabled: true, ambient: 1, exploredBy: 'players' }), BOUNDS, measurement);
    expect(byPlayers.rebuilt).toBe(true);
    expect(byPlayers.model.explored?.polygons).toEqual([byPlayers.model.sight.regions[0]!.polygon]);

    const back = builder.update(scene({ enabled: true, ambient: 1, exploredBy: 'gm' }), BOUNDS, measurement);
    expect(back.rebuilt).toBe(true);
    expect(back.model.explored).toBeNull();
  });
});
