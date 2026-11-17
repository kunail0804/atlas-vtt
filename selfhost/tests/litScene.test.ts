import { describe, expect, it } from 'vitest';
import type { SharedLightingScene, SharedSight } from '../../src/app/online/protocol/lighting.ts';
import { LitSceneBuilder } from '../player/src/litScene.ts';

const TORCH = { bright: 20, dim: 40, color: '#ffb347', intensity: 1, animation: 'none' };
const SCENE: SharedLightingScene = { cellSize: 70, unitDistance: 5, walls: [{ p: [0, 0, 100, 0] }, { p: [100, 0, 100, 100], door: 'closed' }], zones: [], senses: [] };

/** A `sight` message with the hero at `x`, parsed anew as the page parses every message. */
function sight(x: number, changes: Partial<SharedSight> = {}): SharedSight {
  return structuredClone({
    lighting: { enabled: true, ambient: 0.1 },
    lights: [{ id: 'lamp', x: 50, y: 50, emission: TORCH }],
    tokens: [
      { id: 'hero', x, y: 40, size: 1, vision: { senses: [], sightRange: 60 }, light: TORCH },
      { id: 'goblin', x: 300, y: 40, size: 1 },
    ],
    held: [],
    ...changes,
  });
}

// The GM sends `sight` at every step of a drag: what the step did not change keeps its object, since
// the lighting traces again whatever it finds changed by reference (`SceneModelBuilder`).
describe('the lit scene of the players’ page, message after message', () => {
  it('makes again only the token that moved', () => {
    const builder = new LitSceneBuilder();
    const before = builder.build(SCENE, sight(10));
    const after = builder.build(SCENE, sight(20));
    expect(after.state.objects.walls).toBe(before.state.objects.walls);
    expect(after.state.objects.lightZones).toBe(before.state.objects.lightZones);
    expect(after.state.objects.lights).toBe(before.state.objects.lights);
    expect(after.state.grid).toBe(before.state.grid);
    expect(after.state.lighting).toBe(before.state.lighting);
    expect(after.state.heldTokens).toBe(before.state.heldTokens);
    expect(after.rules).toBe(before.rules);
    expect(after.state.objects.tokens).not.toBe(before.state.objects.tokens);
    expect(after.state.objects.tokens.goblin).toBe(before.state.objects.tokens.goblin);
    expect(after.state.objects.tokens.hero).toMatchObject({ x: 20, y: 40 });
  });

  it('keeps the whole scene when nothing changed', () => {
    const builder = new LitSceneBuilder();
    const before = builder.build(SCENE, sight(10));
    expect(builder.build(SCENE, sight(10)).state.objects.tokens).toBe(before.state.objects.tokens);
  });

  it('follows every change the message makes', () => {
    const builder = new LitSceneBuilder();
    const before = builder.build(SCENE, sight(10));
    const changed = builder.build(SCENE, sight(10, {
      lighting: { enabled: true, ambient: 0.5 },
      lights: [{ id: 'lamp', x: 60, y: 50, emission: TORCH }],
      held: [{ id: 'hero', x: 10, y: 40 }],
    }));
    expect(changed.state.lighting.ambient).toBe(0.5);
    expect(changed.state.objects.lights.lamp).toMatchObject({ x: 60 });
    expect(changed.state.heldTokens).toEqual({ hero: { x: 10, y: 40 } });
    // Another vision is other rules; the tokens' order is the GM's.
    const seeing = builder.build(SCENE, sight(10, { tokens: [{ id: 'goblin', x: 300, y: 40, size: 1 }, { id: 'hero', x: 10, y: 40, size: 1, vision: { senses: [], sightRange: 30 } }] }));
    expect(seeing.rules).not.toBe(before.rules);
    expect(seeing.rules.visionOf?.(seeing.state.objects.tokens.hero!)).toEqual({ senses: [], sightRange: 30 });
    expect(Object.keys(seeing.state.objects.tokens)).toEqual(['goblin', 'hero']);
  });

  it('makes the walls again for a new lighting message, and stays blind with a stand-in that sees nothing', () => {
    const builder = new LitSceneBuilder();
    const before = builder.build(SCENE, sight(10));
    const after = builder.build({ ...SCENE, walls: [{ p: [0, 0, 50, 0] }] }, sight(10, { tokens: [], blind: true }));
    expect(after.state.objects.walls).not.toBe(before.state.objects.walls);
    expect(Object.keys(after.state.objects.walls)).toHaveLength(1);
    const standIn = Object.values(after.state.objects.tokens)[0]!;
    expect(standIn.vision?.enabled).toBe(true);
    expect(after.rules.visionOf?.(standIn)).toEqual({ senses: [], pending: true });
  });
});
