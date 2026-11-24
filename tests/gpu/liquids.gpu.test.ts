/// <reference types="vite/client" />
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { DUNGEON_STYLES, type DungeonStyleId } from '../../src/app/dungeons/styleCatalog';
import { acidPng, acidScene } from './liquidAcidHarness';
import { Container, RenderTexture, WebGLRenderer, Ticker, UniformGroup, Graphics, type TextureSource } from 'pixi.js';
import { LiquidMesh } from '../../src/app/pixi/liquids/LiquidMesh';
import { paletteOf, parseHex } from '../../src/app/dungeons/render/palette';
import { DEFAULT_VIEW } from '../../src/app/dungeons/style';
import { pointInPolygon } from '../../src/app/vision/visibility';
import { lavaDungeon, lavaPng, LAVA_SIZE } from './liquidLavaHarness';
import { LightFlicker } from '../../src/app/pixi/lighting/lightFlicker';
import { LiquidLayer, type LiquidLayerDeps } from '../../src/app/pixi/liquids/LiquidLayer';
import { liquidDetail } from '../../src/app/pixi/liquids/viewLiquids';
import type { LiquidSurface, LiquidKind } from '../../src/app/types/liquidTypes';
import { activeLights, engineLight } from '../../src/app/vision/lightSources';
import { createTestRenderer } from '../../src/app/pixi/lighting/engine/__tests__/gpuTestUtils';
import type { Point } from '../../src/app/types/visionTypes';
import { meanChange, WATER_CAPTURE, waterPicture, waterPng, waterScene, type WaterSource } from './waterEvidenceHarness';

describe('acid in the real generated map artwork', () => {
  const capture = import.meta.env.VITE_ACID_CAPTURE as string | undefined;
  const only = import.meta.env.VITE_ACID_LOOK as string | undefined;
  // Longer proofs show a whole slow bubble lifecycle; the routine gate stays short.
  const frames = import.meta.env.VITE_ACID_FULL_CYCLE ? 360 : 90;

  for (const { id } of DUNGEON_STYLES) for (const mono of [false, true]) {
    const name = `${id}${mono ? '-mono' : ''}`;
    it(`moves quietly over ${name} and holds its poster`, async () => {
      if (only && !only.split(',').includes(name)) return;
      const scene = await acidScene(id, mono);
      try {
        const poster = scene.frame(0);
        if (capture) await acidPng(poster, `${capture}/${name}/still`);
        let last = poster;
        let changed = 0;
        for (let f = 0; f < frames; f++) {
          const pixels = scene.frame(f / 30);
          if (capture) await acidPng(pixels, `${capture}/${name}/frames/${String(f).padStart(3, '0')}`);
          for (let k = 0; k < pixels.length; k += 4) changed += Math.abs(pixels[k]! - last[k]!);
          last = pixels;
        }
        expect(changed).toBeGreaterThan(100);
        scene.layer.setMode('poster');
        expect(scene.frame(frames / 30)).toEqual(poster);
      } finally { scene.destroy(); }
    });
  }
});

it('lays pigment over the illustration without additive light', async () => {
  const renderer = new WebGLRenderer();
  await renderer.init({ width: 256, height: 256 });
  const mesh = new LiquidMesh({ id: 'acid-ink-test', kind: 'liquid', liquid: 'acid', polygon: [{ x: 0, y: 0 }, { x: 256, y: 0 }, { x: 256, y: 256 }, { x: 0, y: 256 }], colors: { surface: '#ffffff', deep: '#ffffff', glint: '#ffffff' } }, 100);
  const world = new Container();
  world.addChild(mesh.mesh);
  const target = RenderTexture.create({ width: 256, height: 256 });
  try {
    let excess = 0;
    for (const seconds of [0, 0.5, 2, 7]) {
      mesh.setTime(seconds);
      renderer.render({ container: world, target, clear: true, clearColor: [0, 0, 0, 0] });
      // readPixels keeps premultiplication, whereas PIXI extract unpremultiplies it.
      const pixels = new Uint8Array(256 * 256 * 4);
      renderer.gl.readPixels(0, 0, 256, 256, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, pixels);
      for (let k = 0; k < pixels.length; k += 4) if (pixels[k]! > pixels[k + 3]! + 1) excess++;
    }
    expect(excess).toBe(0);
    const picture = (time: number): Uint8Array => {
      mesh.setTime(time);
      renderer.render({ container: world, target, clear: true, clearColor: [0, 0, 0, 0] });
      const pixels = new Uint8Array(256 * 256 * 4);
      renderer.gl.readPixels(0, 0, 256, 256, renderer.gl.RGBA, renderer.gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    const beforeWrap = picture(4096 - 1 / 60);
    const afterWrap = picture(4096 + 1 / 60);
    const delta = afterWrap.reduce((sum, value, index) => sum + Math.abs(value - beforeWrap[index]!), 0) / afterWrap.length;
    expect(delta).toBeLessThan(0.5);
  } finally { mesh.destroy(); world.destroy(); target.destroy(true); renderer.destroy(); }
});

describe('lava in the generated map artwork', () => {
  const phase = import.meta.env.VITE_LAVA_CAPTURE as string | undefined;
  const only = import.meta.env.VITE_LAVA_LOOK as string | undefined;

  let renderer: WebGLRenderer;
  beforeAll(async () => { renderer = new WebGLRenderer(); await renderer.init({ ...LAVA_SIZE, antialias: false }); });
  afterAll(() => renderer.destroy());
  for (const { id, style } of DUNGEON_STYLES) {
    if (only && !only.split(',').includes(id)) continue;
    for (const monochrome of [false, true]) {
      const name = `${id}${monochrome ? '-mono' : ''}`;
      it(`renders moving lava over ${name}`, async () => {
        const scene = lavaDungeon(id, monochrome);
        const target = RenderTexture.create(LAVA_SIZE);
        const pixels = (): Uint8ClampedArray => {
          renderer.render({ container: scene.world, target, clear: true });
          return new Uint8ClampedArray(renderer.extract.pixels({ target }).pixels);
        };
        try {
          scene.meshes.forEach(m => { m.mesh.visible = false; });
          const staticArt = pixels();
          if (phase) await lavaPng(staticArt, `${phase}/${name}/static`);
          scene.meshes.forEach(m => { m.mesh.visible = true; m.setTime(20); });
          const start = pixels();
          expect(start).not.toEqual(staticArt);
          if (!phase && monochrome) {
            const palette = paletteOf(style, { ...DEFAULT_VIEW, monochrome });
            const a = parseHex(palette.ink);
            const b = parseHex(palette.floor);
            for (const picture of [staticArt, start]) {
              let offPalette = 0;
              let count = 0;
              for (let y = 0; y < LAVA_SIZE.height; y += 3) for (let x = 0; x < LAVA_SIZE.width; x += 3) {
                if (!scene.meshes.some(m => pointInPolygon({ x, y }, m.surface.polygon) && !(m.surface.holes ?? []).some(h => pointInPolygon({ x, y }, h)))) continue;
                const at = (y * LAVA_SIZE.width + x) * 4;
                const rgb = [picture[at]!, picture[at + 1]!, picture[at + 2]!];
                const axis = b.map((c, i) => c - a[i]!);
                const t = Math.max(0, Math.min(1, rgb.reduce((sum, c, i) => sum + (c - a[i]!) * axis[i]!, 0) / axis.reduce((sum, c) => sum + c * c, 0)));
                const error = Math.hypot(...rgb.map((c, i) => c - a[i]! - t * axis[i]!));
                if (error > 35) offPalette++;
                count++;
              }
              expect(offPalette / count).toBeLessThan(0.05);
            }
          }
          if (phase) await lavaPng(start, `${phase}/${name}/still`);
          let last = start;
          let maxMeanStep = 0;
          for (let frame = 0; frame < (phase ? 90 : 3); frame++) {
            scene.meshes.forEach(m => m.setTime(20 + frame / 30));
            const next = pixels();
            let change = 0;
            for (let k = 0; k < next.length; k++) change += Math.abs(next[k]! - last[k]!);
            maxMeanStep = Math.max(maxMeanStep, change / next.length);
            if (phase) await lavaPng(next, `${phase}/${name}/frame-${String(frame).padStart(3, '0')}`);
            last = next;
          }
          expect(last).not.toEqual(start);
          expect(maxMeanStep).toBeLessThan(2);
        } finally { target.destroy(true); scene.destroy(); }
      });
    }
  }
});

describe('lava playback and light coherence', () => {
  const lava: LiquidSurface = {
    id: 'cut-half', kind: 'liquid', liquid: 'lava', lavaLight: 'whole-lava-area',
    polygon: [{ x: 0, y: 0 }, { x: 240, y: 0 }, { x: 240, y: 240 }, { x: 0, y: 240 }],
    colors: { surface: '#d66028', deep: '#702414', glint: '#f09646' },
  };

  function glow(mesh: LiquidMesh): number {
    const group = mesh.mesh.shader?.resources.liquid;
    if (!(group instanceof UniformGroup)) throw new Error('No liquid uniforms');
    return group.uniforms.uLavaGlow as number;
  }

  let renderer: WebGLRenderer;
  beforeAll(async () => { renderer = new WebGLRenderer(); await renderer.init({ width: 240, height: 240 }); });
  afterAll(() => renderer.destroy());

  it('uses the linked light phase at the lighting clock, even when a bridge split the lava', () => {
    const a = new LiquidMesh(lava, 90);
    const b = new LiquidMesh({ ...lava, id: 'other-half' }, 90);
    const light = new LightFlicker();
    const placed = activeLights({ linked: { id: lava.lavaLight!, kind: 'light', x: 120, y: 120, area: lava.polygon, emission: { kind: 'custom', bright: 5, dim: 10, color: '#ff6622', intensity: 1, animation: 'smoulder' } } }, {});
    const source = engineLight(placed[0]!, { cellSize: 90, unitDistance: 5 });
    try {
      for (const at of [0, 30, 123456, 4096000, 86400000]) {
        a.setTime(20, at);
        b.setTime(20, at);
        expect(glow(a)).toBeCloseTo(light.sample(source.key, source.animation, at).intensity, 7);
        expect(glow(a)).toBe(glow(b));
      }
      a.setDetail(0);
      a.setTime(20, 123456);
      expect(glow(a)).toBe(1);
    } finally { a.destroy(); b.destroy(); }
  });

  it('holds poster and pause pixels, restores captures, and observes each frame budget', () => {
    for (const fps of [30, 15, 10]) {
      const ticker = new Ticker();
      ticker.autoStart = false;
      let now = 100000;
      let requests = 0;
      // The layer reads the cell size and the liquids alone.
      const state = { grid: { size: 90 }, objects: { liquids: { lava } } } as unknown as ReturnType<LiquidLayerDeps['store']['getState']>;
      const layer = new LiquidLayer({ store: { getState: () => state, subscribe: () => () => undefined }, ticker, now: () => now, inView: () => true, drawable: true, fps: () => fps, detail: () => liquidDetail(fps), requestRender: () => { requests++; } });
      const target = RenderTexture.create({ width: 240, height: 240 });
      const picture = (): Uint8ClampedArray => {
        renderer.render({ container: layer.container, target, clear: true });
        return new Uint8ClampedArray(renderer.extract.pixels({ target }).pixels);
      };
      const tick = (): void => { now += 1000 / 60; ticker.update(now); };
      try {
        layer.buildPending();
        layer.setMode('poster');
        const poster = picture();
        for (let i = 0; i < 20; i++) tick();
        expect(picture()).toEqual(poster);
        layer.setMode('play');
        requests = 0;
        for (let i = 0; i < 60; i++) tick();
        expect(requests).toBeLessThanOrEqual(fps + 1);
        const moving = picture();
        expect(moving).not.toEqual(poster);
        const restore = layer.stillFor();
        expect(picture()).toEqual(poster);
        restore();
        expect(picture()).toEqual(moving);
        layer.setMode('pause');
        for (let i = 0; i < 20; i++) tick();
        expect(picture()).toEqual(moving);
      } finally { layer.destroy(); ticker.destroy(); target.destroy(true); }
    }
  });

  it('keeps the material continuous as drifts and the shader clock wrap', () => {
    const mesh = new LiquidMesh(lava, 90);
    const world = new Container();
    world.addChild(mesh.mesh);
    const target = RenderTexture.create({ width: 240, height: 240 });
    const picture = (seconds: number): Uint8ClampedArray => {
      mesh.setTime(seconds);
      renderer.render({ container: world, target, clear: true });
      return new Uint8ClampedArray(renderer.extract.pixels({ target }).pixels);
    };
    try {
      for (const at of [4096, 64 / 0.012, 64 / 0.01]) {
        const a = picture(at - 1 / 60);
        const b = picture(at + 1 / 60);
        let delta = 0;
        for (let i = 0; i < a.length; i++) delta += Math.abs(a[i]! - b[i]!);
        expect(delta / a.length).toBeLessThan(1);
      }
    } finally { mesh.destroy(); world.destroy(); target.destroy(true); }
  });
});

describe('the liquid layer', () => {
  /**
   * The liquid layer as a view uses it: it draws nothing outside a surface's outline or inside its
   * holes, asks for renders only while it plays and is in view, gives a picture of the scene the
   * still moment and puts the moment shown back after it, and leaves nothing behind.
   */

  const SIZE = 320;
  const CELL = 70;
  const COLORS = { surface: '#4f86a8', deep: '#1d3f5c', glint: '#e8f7ff' };

  /** A lake that bends round on itself, with an island. */
  const LAKE: Point[] = Array.from({ length: 90 }, (_, k) => {
    const angle = (k / 90) * Math.PI * 2;
    const radius = 120 * (1 + 0.3 * Math.sin(angle * 3));
    return { x: 160 + Math.cos(angle) * radius, y: 160 + Math.sin(angle) * radius * 0.8 };
  });
  const ISLAND: Point[] = [{ x: 140, y: 140 }, { x: 185, y: 145 }, { x: 175, y: 185 }, { x: 135, y: 175 }];

  function shoreDistance(point: Point): number {
    let nearest = Infinity;
    for (const ring of [LAKE, ISLAND]) {
      ring.forEach((a, index) => {
        const b = ring[(index + 1) % ring.length]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
        nearest = Math.min(nearest, Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t));
      });
    }
    return nearest;
  }

  /** How many pixels two pictures differ in. */
  function differing(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
    let count = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) count++;
    return count;
  }

  type State = ReturnType<LiquidLayerDeps['store']['getState']>;

  function storeOf(liquids: Record<string, LiquidSurface>): LiquidLayerDeps['store'] & { set(liquids: Record<string, LiquidSurface>): void } {
    let state = { objects: { liquids }, levels: undefined, viewedLevel: undefined, grid: { size: CELL } } as unknown as State;
    const listeners = new Set<(state: State) => void>();
    return {
      getState: () => state,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      set(next) {
        state = { ...state, objects: { liquids: next } } as unknown as State;
        for (const listener of listeners) listener(state);
      },
    };
  }

  const lake = (liquid: LiquidKind): LiquidSurface => ({ id: `lake-${liquid}`, kind: 'liquid', liquid, polygon: LAKE, holes: [ISLAND], colors: COLORS, flow: { x: 1, y: 0 } });

  interface Harness {
    layer: LiquidLayer;
    ticker: Ticker;
    renders: () => number;
    clock: { now: number };
    store: ReturnType<typeof storeOf>;
  }

  function harness(liquids: Record<string, LiquidSurface>, inView = (): boolean => true): Harness {
    const ticker = new Ticker();
    ticker.autoStart = false;
    ticker.stop();
    let renders = 0;
    const clock = { now: 0 };
    const store = storeOf(liquids);
    const layer = new LiquidLayer({ store, ticker, requestRender: () => { renders++; }, inView, drawable: true, now: () => clock.now });
    layer.buildPending();
    return { layer, ticker, renders: () => renders, clock, store };
  }

  /** Runs the layer's ticker over `seconds` at 60 frames a second. */
  function play({ ticker, clock }: Harness, seconds: number): void {
    for (let frame = 0; frame < seconds * 60; frame++) {
      clock.now += 1000 / 60;
      ticker.update(clock.now);
    }
  }

  let renderer: WebGLRenderer;
  beforeAll(async () => { renderer = await createTestRenderer(SIZE); });
  afterAll(() => renderer.destroy());

  /** The scene's pixels with the layer over a striped backdrop, at `zoom` about the lake's middle. */
  function picture(layer: LiquidLayer | null, zoom: number): Uint8ClampedArray {
    const world = new Container();
    const backdrop = new Graphics();
    for (let x = -400; x < 800; x += 20) backdrop.rect(x, -400, 10, 1200).fill(x % 40 === 0 ? 0x8a7f6a : 0x5a6b4c);
    world.addChild(backdrop);
    if (layer) world.addChild(layer.container);
    world.scale.set(zoom);
    world.position.set(SIZE / 2 - 160 * zoom, SIZE / 2 - 160 * zoom);
    const target = RenderTexture.create({ width: SIZE, height: SIZE, antialias: false });
    renderer.render({ container: world, target, clear: true });
    const { pixels } = renderer.extract.pixels({ target });
    target.destroy(true);
    if (layer) world.removeChild(layer.container);
    world.destroy({ children: true });
    return new Uint8ClampedArray(pixels);
  }

  it('draws inside each surface\'s outline only, never on what stands dry in it', () => {
    for (const liquid of ['water', 'lava', 'acid'] as const) {
      const scene = harness({ lake: lake(liquid) });
      scene.layer.setMode('play');
      play(scene, 3);
      for (const zoom of [0.4, 1, 3.5]) {
        const plain = picture(null, zoom);
        const drawn = picture(scene.layer, zoom);
        let changed = 0;
        const strays: string[] = [];
        for (let y = 0; y < SIZE; y++) {
          for (let x = 0; x < SIZE; x++) {
            const at = (y * SIZE + x) * 4;
            if (plain[at] === drawn[at] && plain[at + 1] === drawn[at + 1] && plain[at + 2] === drawn[at + 2]) continue;
            changed++;
            const world = { x: (x + 0.5 - SIZE / 2) / zoom + 160, y: (y + 0.5 - SIZE / 2) / zoom + 160 };
            // A pixel whose centre lies on the outline to within the rasteriser's rounding may go either way.
            const onOutline = shoreDistance(world) < 0.01 / zoom;
            if (!onOutline && (!pointInPolygon(world, LAKE) || pointInPolygon(world, ISLAND))) strays.push(`${liquid} at zoom ${zoom}: ${x},${y}`);
          }
        }
        expect(changed, `${liquid} draws at zoom ${zoom}`).toBeGreaterThan(1000);
        expect(strays.slice(0, 5)).toEqual([]);
      }
      scene.layer.destroy();
    }
  });

  it('asks for at most 30 renders a second while it plays and a surface is in view, and none otherwise', () => {
    let shown = true;
    const scene = harness({ lake: lake('water') }, () => shown);
    scene.layer.setMode('play');
    const start = scene.renders();
    play(scene, 2);
    const playing = scene.renders() - start;
    expect(playing).toBeGreaterThanOrEqual(55);
    expect(playing).toBeLessThanOrEqual(61);

    shown = false;
    const hidden = scene.renders();
    play(scene, 2);
    expect(scene.renders()).toBe(hidden);
    shown = true;

    for (const mode of ['pause', 'poster'] as const) {
      scene.layer.setMode(mode);
      const before = scene.renders();
      play(scene, 2);
      expect(scene.renders(), mode).toBe(before);
    }
    scene.layer.destroy();

    const empty = harness({});
    empty.layer.setMode('play');
    play(empty, 2);
    expect(empty.renders()).toBe(0);
    empty.layer.destroy();
  });

  it('holds the moment shown while paused, and shows the still moment with animation off and in a picture of the scene', () => {
    const still = harness({ lake: lake('lava') });
    still.layer.setMode('poster');
    const stillPicture = picture(still.layer, 1);

    const scene = harness({ lake: lake('lava') });
    scene.layer.setMode('play');
    play(scene, 4);
    const played = picture(scene.layer, 1);
    expect(differing(played, stillPicture)).toBeGreaterThan(1000);
    scene.layer.setMode('pause');
    play(scene, 2);
    expect(differing(picture(scene.layer, 1), played)).toBe(0);

    const restore = scene.layer.stillFor();
    expect(differing(picture(scene.layer, 1), stillPicture)).toBe(0);
    restore();
    expect(differing(picture(scene.layer, 1), played)).toBe(0);

    scene.layer.setMode('poster');
    expect(differing(picture(scene.layer, 1), stillPicture)).toBe(0);
    still.layer.destroy();
    scene.layer.destroy();
  });

  it('builds a surface anew when it changes, drops it when it goes, and leaves no texture behind', () => {
    const managed = (): number => (renderer.texture as unknown as { managedTextures: (TextureSource | null)[] }).managedTextures.filter(Boolean).length;
    const before = managed();
    const scene = harness({ a: lake('water'), b: { ...lake('acid'), id: 'b' } });
    picture(scene.layer, 1);
    expect(scene.layer.surfaceCount).toBe(2);
    expect(managed()).toBe(before + 2);
    scene.store.set({ a: { ...lake('water'), flow: { x: 0, y: 1 } } });
    scene.layer.buildPending();
    picture(scene.layer, 1);
    expect(scene.layer.surfaceCount).toBe(1);
    expect(managed()).toBe(before + 1);
    scene.layer.destroy();
    expect(scene.layer.container.destroyed).toBe(true);
    expect(managed()).toBe(before);
  });
});

/** VITE_WATER_PHASE=before|after VITE_WATER_CAPTURE=1 saves 90 deterministic frames per look. */
describe('water belongs to the generated map artwork', () => {
  let renderer: Awaited<ReturnType<typeof createTestRenderer>>;
  beforeAll(async () => { renderer = await createTestRenderer(960); });
  afterAll(() => renderer.destroy());

  const cases: { id: DungeonStyleId; mono: boolean; source: WaterSource }[] = DUNGEON_STYLES.flatMap(({ id }) => [false, true].map(mono => ({ id, mono, source: 'pool' as const })));
  cases.push({ id: 'parchment', mono: false, source: 'channel' }, { id: 'print', mono: false, source: 'channel' }, { id: 'crayon', mono: false, source: 'channel' });
  cases.push({ id: 'parchment', mono: false, source: 'river' }, { id: 'contrast', mono: false, source: 'river' }, { id: 'crayon', mono: false, source: 'river' });
  for (const { id, mono, source } of cases) {
    const name = `${id}${mono ? '-mono' : ''}${source === 'pool' ? '' : `-${source}`}`;
    it(`renders still art and calm, visibly moving water in ${name}`, async () => {
      const scene = await waterScene(id, mono, source);
      try {
        scene.layer.container.visible = false;
        const art = waterPicture(renderer, scene);
        scene.layer.container.visible = true;
        scene.step(8);
        const first = waterPicture(renderer, scene);
        expect(meanChange(art, first)).toBeGreaterThan(0.02);
        if (WATER_CAPTURE) {
          await waterPng(art, `${name}/art`);
          await waterPng(first, `${name}/still`);
        }
        let previous = first;
        let maxStep = 0;
        const frames = WATER_CAPTURE ? 90 : 6;
        for (let frame = 0; frame < frames; frame++) {
          if (frame > 0) scene.step(1 / 30);
          const pixels = waterPicture(renderer, scene);
          maxStep = Math.max(maxStep, meanChange(previous, pixels));
          if (WATER_CAPTURE) await waterPng(pixels, `${name}/frames/${String(frame).padStart(3, '0')}`);
          previous = pixels;
        }
        expect(meanChange(first, previous)).toBeGreaterThan(0.001);
        // Visibly alive at play zoom a second on: the water moved too faintly to see before 2026-10-25.
        scene.step(1);
        const alive = meanChange(first, waterPicture(renderer, scene));
        expect(alive).toBeGreaterThan(0.1);
        expect(maxStep, 'no abrupt flashes between 30 fps frames').toBeLessThan(1.2);
        scene.layer.setMode('poster');
        const poster = waterPicture(renderer, scene);
        scene.step(1);
        expect(meanChange(poster, waterPicture(renderer, scene))).toBe(0);
      } finally { scene.destroy(); }
    });
  }
});

describe('water motion remains subordinate to the map illustration', () => {
  let renderer: Awaited<ReturnType<typeof createTestRenderer>>;
  beforeAll(async () => { renderer = await createTestRenderer(960); });
  afterAll(() => renderer.destroy());
  it('keeps the engraved image free of luminous caustic washes', async () => {
    const scene = await waterScene('print', false);
    try {
      scene.layer.container.visible = false;
      const art = waterPicture(renderer, scene);
      scene.layer.container.visible = true;
      scene.step(8);
      const animated = waterPicture(renderer, scene);
      // Light may break the hatch here and there, as the engraver's own glints do, never wash over it.
      let ink = 0;
      let liftedInk = 0;
      for (let i = 0; i < art.length; i += 4) {
        if (art[i]! >= 120) continue;
        ink++;
        if (animated[i]! - art[i]! > 20) liftedInk++;
      }
      expect(liftedInk / ink, 'thin ink must stay ink, without white caustics laid over it').toBeLessThan(0.05);
    } finally { scene.destroy(); }
  });
  it('changes spatial detail with quality even while the water is held still', async () => {
    const scene = await waterScene('parchment', false);
    try {
      scene.layer.setMode('poster');
      const high = waterPicture(renderer, scene);
      scene.quality(1); scene.step(0.2);
      const balanced = waterPicture(renderer, scene);
      scene.quality(0); scene.step(0.2);
      const saver = waterPicture(renderer, scene);
      expect(meanChange(high, balanced)).toBeGreaterThan(0.005);
      expect(meanChange(balanced, saver)).toBeGreaterThan(0.005);
      expect(meanChange(high, saver)).toBeLessThan(2);
    } finally { scene.destroy(); }
  });
});

// The long-running clock and drift periods are deliberately independent. Neither may jump.
describe('water over long sessions', () => {
  it('keeps pigment and movement continuous at clock and drift wraps', async () => {
    const { Container, RenderTexture } = await import('pixi.js');
    const { LiquidMesh } = await import('../../src/app/pixi/liquids/LiquidMesh');
    const renderer = await createTestRenderer(256);
    const target = RenderTexture.create({ width: 256, height: 256 });
    try {
      for (const art of [undefined, 'engraved', 'crayon'] as const) for (const flowing of [false, true]) {
        const surface = new LiquidMesh({ id: 'wrap-water', kind: 'liquid', liquid: 'water', ...(art && { art }),
          polygon: [{ x: -200, y: -200 }, { x: 500, y: -200 }, { x: 500, y: 500 }, { x: -200, y: 500 }],
          colors: { surface: '#789695', deep: '#344746', glint: '#c8dad9' }, ...(flowing && { flow: { x: 0.6, y: 0.8 } }),
        }, 100);
        const world = new Container();
        world.addChild(surface.mesh);
        try {
          const picture = (seconds: number): Uint8ClampedArray => {
            surface.setTime(seconds);
            renderer.render({ container: world, target, clear: true });
            return renderer.extract.pixels({ target }).pixels;
          };
          // The water's ordinary steps, away from every wrap (they vary with the drips and glints alive): a wrap may move it no more.
          const step = Math.max(...[1000.37, 2000.71, 3100.13].map(t => meanChange(picture(t - 1 / 60), picture(t + 1 / 60))));
          // 64 / 0.28: a channel's ripples (and Crayon's strokes riding them) wrap by a tile.
          for (const time of [1600, 64 / 0.028, 64 / 0.055, 64 / 0.28, 4096, 1e7]) {
            const before = picture(time - 1 / 60);
            const after = picture(time + 1 / 60);
            expect(meanChange(before, after), `${art ?? 'painted'}, flow ${flowing}, time ${time}`).toBeLessThan(step * 1.5 + 0.1);
            // Water is pigment, never additive emission, even on a transparent target.
            for (let i = 0; i < after.length; i += 4) for (let c = 0; c < 3; c++) expect(after[i + c]!).toBeLessThanOrEqual(after[i + 3]! + 1);
          }
        } finally { surface.destroy(); world.destroy(); }
      }
    } finally { target.destroy(true); renderer.destroy(); }
  });
});
