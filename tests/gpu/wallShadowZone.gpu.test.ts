import '../setup/obsidianDom';
import { Application, RenderTexture, Sprite, Texture, Ticker, WebGLRenderer } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInMemoryApp } from '../mocks/inMemoryVault';
import { createViewAtlasStore, type ViewAtlasState } from '../../src/app/storeFactory';
import type { TokenEntity } from '../../src/app/types';
import type { LightEmission, LightSource } from '../../src/app/types/lightingTypes';
import type { WallSegment } from '../../src/app/types/wallTypes';
import type { MeasurementSettings } from '../../src/app/grid/measurementFormat';
import { LightingRenderer } from '../../src/app/pixi/lighting/LightingRenderer';
import { readRgba } from '../../src/app/pixi/lighting/engine/__tests__/gpuTestUtils';
import { lightLevelAt } from '../../src/app/vision/lightLevels';
import { savePng } from './dungeonRenderHarness';

vi.mock('events', async () => import('eventemitter3'));

/** Kunail's scene of #51 and #139: one wall across the map, a torch on either side of it. */
const W = 1448;
const H = 1086;
const MEASUREMENT = { mode: 'imperial', unitType: 'feet', unitDistance: 5, ruleDistance: 5, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 90 } as unknown as MeasurementSettings;
const TORCH: LightEmission = { bright: 20, dim: 40, color: '#ff9a3c', intensity: 1, animation: 'none', sourceRadius: 2, kind: 'torch', preset: 'torch' };
/** 40 ft on a 70 px, 5 ft grid. */
const DIM = 560;
const LOWER = { x: 788, y: 408 };
const WALL = { id: 'w', kind: 'wall', type: 'solid', p1: { x: 461.2, y: 345.15 }, p2: { x: 1038.42, y: 326.2 } } as WallSegment;
const LIGHTS: Record<string, LightSource> = {
  below: { id: 'below', kind: 'light', x: LOWER.x, y: LOWER.y, emission: TORCH },
  above: { id: 'above', kind: 'light', x: 761.6, y: 287.21, emission: TORCH },
};
const HERO = { id: 'hero', kind: 'token', imagePath: '', x: 788, y: 380, size: 1, layer: 0, rotation: 0, isHidden: false, vision: { enabled: true } } as TokenEntity;

type Rgb = readonly [number, number, number];

/** A saved memory that has seen the whole map. */
async function wholeMapMask(): Promise<string> {
  const canvas = new OffscreenCanvas(W, H);
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, W, H);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

async function savePicture(pixels: Uint8ClampedArray, name: string): Promise<void> {
  const canvas = new OffscreenCanvas(W, H);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), W, H), 0, 0);
  await savePng(canvas, name, 'out/wall-shadow-zone');
}

/**
 * A party token under the wall, next to the lower torch, on a map it remembers whole. The rim of
 * the torch's light, where its fade is dimmer than the memory, used to show the memory's grey, so
 * floor the rules count lit looked remembered (#139). It keeps the torch's colour now, turning grey
 * only at its very end, never brighter than the memory, and past the dim radius nothing changed.
 * Pictures in `out/wall-shadow-zone/`.
 */
describe('the rim of a light over explored memory (#139)', () => {
  const cleanup: (() => void)[] = [];
  afterEach(() => {
    while (cleanup.length) cleanup.pop()!();
  });

  async function picture(lights: Record<string, LightSource>, lighting: Partial<ViewAtlasState['lighting']>): Promise<{ at: (x: number, y: number) => Rgb; pixels: Uint8ClampedArray; view: LightingRenderer }> {
    const renderer = new WebGLRenderer();
    await renderer.init({ width: W, height: H, backgroundAlpha: 1, useBackBuffer: true });
    const app = new Application();
    app.renderer = renderer;
    app.ticker = new Ticker();
    const ticks: (() => void)[] = [];
    app.ticker.add = ((tick: () => void) => (ticks.push(tick), app.ticker)) as Ticker['add'];
    const viewport = new Viewport({ screenWidth: W, screenHeight: H, worldWidth: W, worldHeight: H, events: renderer.events });
    viewport.sortableChildren = true;
    app.stage.addChild(viewport);
    const floor = new Sprite(Texture.WHITE);
    floor.setSize(W, H);
    floor.tint = 0xc8b494;
    viewport.addChild(floor);
    const store = createViewAtlasStore(createInMemoryApp().app, `rim-${Math.random()}`);
    store.getState().setPersistenceEnabled(false);
    store.getState().setMapPath('maps/rim.atlasmap');
    const exploredMask = await wholeMapMask();
    store.setState((state) => ({ grid: { ...state.grid, size: 70 }, objects: { ...state.objects, walls: { w: WALL }, lights, tokens: { hero: HERO } }, exploredMask }));
    store.getState().setSceneLighting({ enabled: true, ambient: 0, ...lighting });
    const view = new LightingRenderer({ viewport, app, store, measurement: () => MEASUREMENT, bounds: () => ({ width: W, height: H }), albedo: () => null });
    cleanup.push(() => {
      view.destroy();
      app.ticker.destroy();
      viewport.destroy({ children: true });
      app.stage.destroy();
      renderer.destroy();
    });
    // The saved mask decodes before the first picture.
    await new Promise((resolve) => setTimeout(resolve, 300));
    view.renderForFrame({ x: 0, y: 0, resolution: 1 }, () => undefined);
    view.modeLayer.visible = true;
    const target = RenderTexture.create({ width: W, height: H });
    cleanup.push(() => target.destroy(true));
    for (let i = 0; i < 3; i++) {
      renderer.render({ container: app.stage, target, clear: true });
      ticks.forEach((tick) => tick());
    }
    renderer.render({ container: app.stage, target, clear: true });
    const pixels = readRgba(renderer, target);
    return { pixels, view, at: (x, y) => [pixels[(y * W + x) * 4]!, pixels[(y * W + x) * 4 + 1]!, pixels[(y * W + x) * 4 + 2]!] };
  }

  const sum = (rgb: Rgb): number => rgb[0] + rgb[1] + rgb[2];
  /** How far a colour is from grey: its strongest channel less its weakest, over its strongest. */
  const tint = (rgb: Rgb): number => (Math.max(...rgb) - Math.min(...rgb)) / Math.max(Math.max(...rgb), 1);

  it('keeps the light of a torch in its rim, over memory, and changes nothing past it', async () => {
    const shown = await picture(LIGHTS, { exploredBy: 'gm' });
    const light = await picture(LIGHTS, { tokenVision: false });
    const memory = await picture({}, { exploredBy: 'gm' });
    await savePicture(shown.pixels, 'test-players');
    const reaches = shown.view.lightReaches();
    const ambient = shown.view.ambientLight();
    const rim: string[] = [];
    // Straight down and down the sides from the lower torch: floor the token sees, lit by that torch alone.
    for (const angle of [70, 90, 110]) {
      const dx = Math.cos((angle * Math.PI) / 180);
      const dy = Math.sin((angle * Math.PI) / 180);
      for (let d = 60; d < DIM + 60; d += 4) {
        const x = Math.round(LOWER.x + dx * d);
        const y = Math.round(LOWER.y + dy * d);
        const players = shown.at(x, y);
        const lit = light.at(x, y);
        const remembered = memory.at(x, y);
        const where = `${angle}° ${d} px: players ${players.join(' ')}, light ${lit.join(' ')}, memory ${remembered.join(' ')}`;
        if (d > DIM + 3) {
          // Past the dim radius: the memory, as it was.
          expect(lightLevelAt({ x, y }, ambient, reaches), where).toBe('dark');
          if (sum(players) > sum(remembered) + 3 || tint(players) > tint(remembered) + 0.02) rim.push(`brighter or more coloured past the radius, ${where}`);
          continue;
        }
        expect(lightLevelAt({ x, y }, ambient, reaches), where).not.toBe('dark');
        if (sum(lit) >= sum(remembered)) {
          // As bright as the memory or more: the light exactly, as before.
          if (players.some((channel, i) => Math.abs(channel - lit[i]!) > 3)) rim.push(`not the light, ${where}`);
          continue;
        }
        // The rim: never brighter than the memory, never darker than the light, and in the torch's colour but for its last 30 px.
        if (sum(players) > sum(remembered) + 3) rim.push(`brighter than the memory, ${where}`);
        if (sum(players) < sum(lit) - 3) rim.push(`darker than the light, ${where}`);
        if (d < DIM - 30 && tint(players) < 0.3) rim.push(`grey, ${where}`);
      }
    }
    expect(rim).toEqual([]);
  });
});
