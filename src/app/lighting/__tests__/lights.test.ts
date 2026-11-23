import { describe, expect, it } from 'vitest';
import { LIGHT_SCHEDULES, ambientGate, isLightOn, scheduleOf, sleeps } from '../lightActivity';
import { beamOf, directionTo, snapDirection, withBeam } from '../lightBeam';
import { LIGHT_PRESETS } from '../lightPresets';
import { en } from '../../i18n/locales/en';
import { BUILT_IN_SYSTEM_PRESETS } from '../../gameSystems/builtInPresets';
import { GENERIC_LIGHT_PRESETS } from '../../gameSystems/lightPresets/generic';
import { BUILT_IN_LIGHT_NAMES, lightPresetName } from '../lightPresetNames';

const TORCH = LIGHT_PRESETS.torch.emission;

it('a light that follows the ambient light', () => {
  // is on at or below its level, and off while the scene is brighter
  {
    const lamp = { activeBelowAmbient: 0.5 };
    expect(isLightOn(lamp, 1)).toBe(false);
    expect(isLightOn(lamp, 0.51)).toBe(false);
    // At dusk itself a lamp set to dusk burns.
    expect(isLightOn(lamp, 0.5)).toBe(true);
    expect(isLightOn(lamp, 0)).toBe(true);
    expect(sleeps(lamp, 1)).toBe(true);
    expect(sleeps(lamp, 0.5)).toBe(false);
  }

  // is always on without a level, and never while it is switched off
  {
    expect(isLightOn({}, 1)).toBe(true);
    expect(sleeps({}, 1)).toBe(false);
    expect(isLightOn({ hidden: true }, 0)).toBe(false);
    expect(isLightOn({ hidden: true, activeBelowAmbient: 0.5 }, 0)).toBe(false);
    // Switched off is not asleep: the GM put it out.
    expect(sleeps({ hidden: true, activeBelowAmbient: 0.5 }, 1)).toBe(false);
  }

  // reads a level of full daylight, or one that is no level, as always on
  {
    expect(ambientGate({ activeBelowAmbient: 1 })).toBeUndefined();
    expect(ambientGate({ activeBelowAmbient: -0.2 })).toBe(0);
    expect(ambientGate({ activeBelowAmbient: Number.NaN })).toBeUndefined();
    expect(ambientGate({ activeBelowAmbient: 'dusk' as never })).toBeUndefined();
    expect(isLightOn({ activeBelowAmbient: 1 }, 1)).toBe(true);
  }

  // offers the times of day a lamp comes on at, and names any other level
  {
    expect(LIGHT_SCHEDULES.map(({ label, level }) => [label, level])).toEqual([['Always', undefined], ['From dusk', 0.5], ['At night', 0.15]]);
    expect(scheduleOf({})).toEqual({ value: 'always', label: 'Always' });
    expect(scheduleOf({ activeBelowAmbient: 0.5 })).toEqual({ value: 'dusk', label: 'From dusk' });
    expect(scheduleOf({ activeBelowAmbient: 0.15 })).toEqual({ value: 'night', label: 'At night' });
    expect(scheduleOf({ activeBelowAmbient: 0.3 })).toEqual({ value: 'custom', label: 'Below 30 % light' });
  }
});

it('a light\'s beam', () => {
  // stores the angle it shines, and none for a light that shines all around
  {
    expect(withBeam(TORCH, 60).angle).toBe(60);
    expect(withBeam({ ...TORCH, angle: 60 }, 360)).toEqual(TORCH);
    expect('angle' in withBeam({ ...TORCH, angle: 60 }, 360)).toBe(false);
    expect(withBeam(TORCH, 360)).toBe(TORCH);
    const lantern = { ...TORCH, angle: 60 };
    expect(withBeam(lantern, 60)).toBe(lantern);
  }

  // faces up at rotation 0 and turns clockwise, as a token does
  {
    expect(beamOf({ emission: { ...TORCH, angle: 90 } })).toEqual({ facing: -Math.PI / 2, angle: Math.PI / 2 });
    expect(beamOf({ rotation: 90, emission: { ...TORCH, angle: 90 } })!.facing).toBeCloseTo(0);
    expect(beamOf({ rotation: 90, emission: { ...TORCH, angle: 90 } }, 35)!.apex).toBe(35);
  }

  // has no beam when it shines all around, and never as a source of darkness
  {
    expect(beamOf({ rotation: 90, emission: TORCH })).toBeUndefined();
    expect(beamOf({ rotation: 90, emission: { ...TORCH, angle: 90, darkness: true } })).toBeUndefined();
  }

  // reads the direction from the light to a point as a rotation
  {
    const light = { x: 100, y: 100 };
    expect(directionTo(light, { x: 100, y: 0 })).toBeCloseTo(0);
    expect(directionTo(light, { x: 200, y: 100 })).toBeCloseTo(90);
    expect(directionTo(light, { x: 100, y: 200 })).toBeCloseTo(180);
    expect(directionTo(light, { x: 0, y: 100 })).toBeCloseTo(270);
  }

  // snaps a direction to five degrees, to whole degrees with Alt, within one turn
  {
    expect(snapDirection(93.4, false)).toBe(95);
    expect(snapDirection(93.4, true)).toBe(93);
    expect(snapDirection(-10, false)).toBe(350);
    expect(snapDirection(358, false)).toBe(0);
    expect(snapDirection(725, false)).toBe(5);
  }
});

describe('light preset names', () => {
  it('translates every built-in light by a key whose English is its name', () => {
    const lights = [...GENERIC_LIGHT_PRESETS, ...BUILT_IN_SYSTEM_PRESETS.flatMap((preset) => preset.rules.lightPresets ?? [])];
    for (const light of lights) {
      const key = BUILT_IN_LIGHT_NAMES[light.name];
      expect(key, light.name).toBeDefined();
      expect(en[key!]).toBe(light.name);
    }
  });

  it('shows a light the GM named as it was named', () => {
    expect(lightPresetName({ name: 'Brazier' })).toBe('Brazier');
  });
});
