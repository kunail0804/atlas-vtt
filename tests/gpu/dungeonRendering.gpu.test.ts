import { describe, expect, it } from 'vitest';
import type { DungeonModel, DungeonRequest } from '../../src/app/dungeons/model';
import { mapLayout } from '../../src/app/dungeons/render/layoutSize';
import { renderMap, fittedPxPerCell, renderMapSvg } from '../../src/app/dungeons/render/renderMap';
import { parseHex, paletteOf } from '../../src/app/dungeons/render/palette';
import { DEFAULT_VIEW, type DungeonView, type GridStyle, type DungeonStyle } from '../../src/app/dungeons/style';
import { dungeonStyle, type DungeonStyleId, DUNGEON_STYLES } from '../../src/app/dungeons/styleCatalog';
import { DUNGEON_FIXTURES } from '../fixtures/dungeonModels';
import { pixelStats, savePng, withoutText, RENDER_OUT } from './dungeonRenderHarness';
import type { ThemeChoice } from '../../src/app/dungeons/themes/themeTypes';
import { generateDungeon } from '../../src/app/dungeons/generate';
import { filledPockets, inPocket } from '../../src/app/dungeons/render/pockets';
import { visibleDungeon } from '../../src/app/dungeons/render/visibleDungeon';
import { renderThumbnail } from '../../src/app/dungeons/render/thumbnail';
import { floorBelow, stackOf } from '../../src/app/dungeons/floors/floorStack';
import { commands } from 'vitest/browser';
import { DRAWN_PROP_KINDS, FIRST_PROP_KINDS } from '../../src/app/dungeons/drawnKinds';
import { drawToken, drawWhole } from './dungeonArtSheets';
import { drawRoom, drawWindow, farthestInk, FOOTPRINT_SLACK, inkMask, offMonochrome, OUTLINE_CONTRAST, outlineContrast, pathCount, type Drawn } from './glyphSheetChecks';
import { aloneRoom, sheetRoom, turnsRoom, type SheetRoom } from './glyphSheetModel';
import type { GlyphSpecimen, SpecimenPiece } from './glyphSheets/types';
import { houseCells } from '../../src/app/dungeons/geometry';
import { OUTER_WALL, doorwayShape, windowSpan } from '../../src/app/dungeons/render/houseShapes';
import { dungeonWalls } from '../../src/app/dungeons/scene/toWalls';
import { edgeHouse } from '../unit/dungeons/house/edgeFixtures';
import { inkMask as inkPixels, nearestInk, wallsOnInk, type Picture } from './dungeonFidelityChecks';

/**
 * Renders the fixtures in a style of each kind, grid style and view, checks the pictures are sane
 * and free of text, and writes them as PNGs to `out/dungeon-render/` for a person to look at.
 */

/** One style of each kind of surroundings, and a dark one; every style is drawn in 'the dungeon styles' below. */
const STYLES = ['parchment', 'masonry', 'stipple', 'drafting', 'slate', 'night'] as const satisfies readonly DungeonStyleId[];

const models = new Map<string, DungeonModel>();

describe('dungeon renderer', () => {
  const GRIDS: GridStyle[] = ['off', 'dotted', 'dashed', 'solid', 'broken'];
  const FIXTURES = Object.keys(DUNGEON_FIXTURES) as (keyof typeof DUNGEON_FIXTURES)[];

  function drawMap(model: DungeonModel, styleId: DungeonStyleId, view: DungeonView, pxPerCell: number): { canvas: OffscreenCanvas } {
    const layout = mapLayout(model, pxPerCell, view);
    const canvas = new OffscreenCanvas(layout.widthPx, layout.heightPx);
    const { ctx, texts } = withoutText(canvas.getContext('2d')!);
    renderMap(ctx, model, dungeonStyle(styleId), view, { pxPerCell });
    expect(texts).toEqual([]);
    return { canvas };
  }

  function expectSane(canvas: OffscreenCanvas, styleId: DungeonStyleId): void {
    const stats = pixelStats(canvas, parseHex(dungeonStyle(styleId).colors.ink));
    // Stone & shadow inks only the line where wall meets floor; Engraved cuts its rock in ink too
    expect(stats.ink).toBeGreaterThan(0.001);
    expect(stats.ink).toBeLessThan(0.6);
    expect(stats.colours).toBeGreaterThan(4);
    expect(stats.transparent).toBe(0);
  }

  for (const fixture of FIXTURES) {
    for (const styleId of STYLES) {
      it(`draws the ${fixture} map in ${styleId}`, async () => {
        const model = DUNGEON_FIXTURES[fixture]();
        const { canvas } = drawMap(model, styleId, DEFAULT_VIEW, fixture === 'large' ? 100 : 60);
        expectSane(canvas, styleId);
        await savePng(canvas, `map-${fixture}-${styleId}`);
      });
    }
  }

  for (const grid of GRIDS) {
    for (const smallTiles of [false, true]) {
      it(`draws a ${grid} grid${smallTiles ? ' in small tiles' : ''}`, async () => {
        const { canvas } = drawMap(DUNGEON_FIXTURES.small(), 'parchment', { ...DEFAULT_VIEW, grid, smallTiles }, 60);
        expectSane(canvas, 'parchment');
        await savePng(canvas, `grid-${grid}${smallTiles ? '-small' : ''}`);
      });
    }
  }

  const variants: [string, Partial<DungeonView>][] = [
    ['monochrome', { monochrome: true }],
    ['no-secrets', { secrets: false }],
    ['bare', { water: false, props: false, shadow: false }],
  ];
  for (const [name, change] of variants) {
    it(`draws the ${name} map`, async () => {
      const { canvas } = drawMap(DUNGEON_FIXTURES.small(), 'parchment', { ...DEFAULT_VIEW, ...change }, 60);
      expectSane(canvas, 'parchment');
      await savePng(canvas, `view-${name}`);
    });
  }

  it('leaves a transparent map transparent outside the drawing', () => {
    const model = DUNGEON_FIXTURES.small();
    const layout = mapLayout(model, 40);
    const canvas = new OffscreenCanvas(layout.widthPx, layout.heightPx);
    renderMap(canvas.getContext('2d')!, model, dungeonStyle('parchment'), DEFAULT_VIEW, { pxPerCell: 40, transparent: true });
    const corner = canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data;
    expect(corner[3]).toBe(0);
  });
});

describe('generated dungeons', () => {
  const CASES: readonly { name: string; seed: number; theme?: ThemeChoice; tags: string[] }[] = [
    { name: 'default', seed: 16, tags: [] },
    { name: 'small', seed: 31337, tags: ['small'] },
    { name: 'large', seed: 777, tags: ['large'] },
    { name: 'ordered', seed: 101, tags: ['ordered'] },
    { name: 'chaotic', seed: 102, tags: ['chaotic'] },
    { name: 'round', seed: 404, theme: 'fortress', tags: ['round', 'colonnades'] },
    { name: 'colonnades', seed: 405, tags: ['colonnades', 'large'] },
    { name: 'flooded', seed: 2024, theme: 'cavern', tags: ['flooded', 'winding'] },
    { name: 'crumbling', seed: 202, tags: ['crumbling'] },
    { name: 'fortress', seed: 777, theme: 'fortress', tags: ['colonnades'] },
    { name: 'cavern', seed: 909, theme: 'cavern', tags: [] },
    { name: 'mansion', seed: 303, theme: 'mansion', tags: ['deep'] },
    { name: 'secret', seed: 515, tags: ['secret'] },
    { name: 'string', seed: 616, tags: ['string'] },
    { name: 'compact', seed: 717, tags: ['compact'] },
    { name: 'winding', seed: 818, tags: ['winding', 'wet'] },
    { name: 'medium', seed: 1020, tags: ['medium'] },
    { name: 'large-flooded', seed: 1121, tags: ['large', 'flooded', 'round'] },
    { name: 'small-ordered', seed: 1222, tags: ['small', 'ordered'] },
  ];
  function modelOf(name: string): DungeonModel {
    let model = models.get(name);
    if (!model) {
      const spec = CASES.find(c => c.name === name)!;
      model = generateDungeon({ seed: spec.seed, ...(spec.theme && { theme: spec.theme }), tags: spec.tags, floors: 1 });
      models.set(name, model);
    }
    return model;
  }

  /** Stone & shadow inks only the line where wall meets floor; Engraved cuts its rock in ink too. */
  const LEAST_INK = 0.001;

  function expectSane(canvas: OffscreenCanvas, styleId: DungeonStyleId): void {
    const stats = pixelStats(canvas, parseHex(dungeonStyle(styleId).colors.ink));
    expect(stats.ink).toBeGreaterThan(LEAST_INK);
    expect(stats.ink).toBeLessThan(0.6);
    expect(stats.transparent).toBe(0);
  }

  /** The map fitted into a 1400 × 1000 preview, as the generator's panel draws it. */
  function preview(model: DungeonModel, styleId: DungeonStyleId, view: DungeonView): OffscreenCanvas {
    const pxPerCell = fittedPxPerCell(model, view, 1400, 1000);
    const layout = mapLayout(model, pxPerCell, view);
    const canvas = new OffscreenCanvas(layout.widthPx, layout.heightPx);
    const { ctx, texts } = withoutText(canvas.getContext('2d')!);
    renderMap(ctx, model, dungeonStyle(styleId), view, { pxPerCell, legibleAt: 1 });
    expect(texts).toEqual([]);
    expect(Math.max(layout.widthPx / 1400, layout.heightPx / 1000)).toBeGreaterThan(0.99);
    return canvas;
  }

  function map(model: DungeonModel, styleId: DungeonStyleId, pxPerCell: number, view: DungeonView = DEFAULT_VIEW): { canvas: OffscreenCanvas } {
    const layout = mapLayout(model, pxPerCell, view);
    const canvas = new OffscreenCanvas(layout.widthPx, layout.heightPx);
    const { ctx, texts } = withoutText(canvas.getContext('2d')!);
    renderMap(ctx, model, dungeonStyle(styleId), view, { pxPerCell });
    expect(texts).toEqual([]);
    return { canvas };
  }

  /** Points of rock the rooms close in on that the drawing left the colour of the paper. */
  function paperInPockets(canvas: OffscreenCanvas, model: DungeonModel, styleId: DungeonStyleId, pxPerCell: number): string[] {
    const style = dungeonStyle(styleId);
    const dungeon = visibleDungeon(model, DEFAULT_VIEW);
    const pockets = filledPockets(dungeon, style.surround.reach);
    const { originCell } = mapLayout(model, pxPerCell, DEFAULT_VIEW);
    const ctx = canvas.getContext('2d')!;
    const [pr, pg, pb] = parseHex(style.colors.paper);
    const out: string[] = [];
    for (const { bounds } of pockets) {
      for (let y = bounds.minY; y < bounds.maxY; y += 0.1) {
        for (let x = bounds.minX; x < bounds.maxX; x += 0.1) {
          if (!inPocket(pockets, x, y) || dungeon.field.distance(x, y) < 0.2) continue;
          // A patch of paper, not one pixel: an inked edge blended over the shading can match the paper's colour
          const patch = ctx.getImageData(Math.floor((x - originCell.x) * pxPerCell) - 1, Math.floor((y - originCell.y) * pxPerCell) - 1, 3, 3).data;
          let paper = true;
          for (let i = 0; i < patch.length; i += 4) paper &&= Math.abs(patch[i]! - pr) + Math.abs(patch[i + 1]! - pg) + Math.abs(patch[i + 2]! - pb) < 6;
          if (paper) out.push(`${x.toFixed(1)},${y.toFixed(1)}`);
        }
      }
    }
    return out;
  }

  for (const { name } of CASES) {
    it(`draws the ${name} preview in parchment`, async () => {
      const canvas = preview(modelOf(name), 'parchment', DEFAULT_VIEW);
      expectSane(canvas, 'parchment');
      await savePng(canvas, `gen-preview-${name}-parchment`);
    });
  }

  for (const name of ['default', 'large', 'round', 'flooded', 'crumbling'] as const) {
    for (const styleId of STYLES.filter(p => p !== 'parchment')) {
      it(`draws the ${name} preview in ${styleId}`, async () => {
        const canvas = preview(modelOf(name), styleId, DEFAULT_VIEW);
        expectSane(canvas, styleId);
        await savePng(canvas, `gen-preview-${name}-${styleId}`);
      });
    }
  }

  for (const name of ['default', 'round', 'flooded'] as const) {
    for (const styleId of STYLES) {
      it(`draws the ${name} map in ${styleId}`, async () => {
        const { canvas } = map(modelOf(name), styleId, 100);
        expectSane(canvas, styleId);
        if (name === 'default') expect(filledPockets(visibleDungeon(modelOf(name), DEFAULT_VIEW), 0.5).length).toBeGreaterThan(0);
        // Stippling thins out on its own and fills no rock whole.
        if (dungeonStyle(styleId).surround.mode !== 'dots') expect(paperInPockets(canvas, modelOf(name), styleId, 100)).toEqual([]);
        await savePng(canvas, `gen-map-${name}-${styleId}`);
      });
    }
  }

  const views: [string, Partial<DungeonView>][] = [
    ['monochrome', { monochrome: true }],
    ['no-secrets', { secrets: false }],
  ];
  for (const [label, change] of views) {
    it(`draws the secret preview as ${label}`, async () => {
      const canvas = preview(modelOf('secret'), 'parchment', { ...DEFAULT_VIEW, ...change });
      expectSane(canvas, 'parchment');
      await savePng(canvas, `gen-view-${label}`);
    });
  }
});

describe('the dungeon styles', () => {
  /**
   * Every look of the gallery on three generated dungeons: the gallery's card, the preview, a
   * stretch of the scene map at 100 px per cell (what a table sees under its tokens), the card in
   * monochrome and the stretch with a solid grid, written to `out/dungeon-render/styles/` for a person to judge side by side.
   */

  const DUNGEONS: readonly { name: string; seed: number; theme?: ThemeChoice; tags: string[] }[] = [
    { name: 'halls', seed: 16, tags: ['dry'] },
    { name: 'flooded', seed: 2024, theme: 'cavern', tags: ['flooded', 'winding'] },
    { name: 'fortress', seed: 404, theme: 'fortress', tags: ['round', 'colonnades', 'crumbling'] },
  ];

  /** The gallery's card at a device pixel ratio of 2. */
  const CARD = { width: 272, height: 204, legibleAt: 2 };
  /** A stretch of the scene map at 100 px per cell. */
  const TABLE = { width: 1100, height: 800, legibleAt: 1 };
  function modelOf(name: string): DungeonModel {
    let model = models.get(name);
    if (!model) {
      const spec = DUNGEONS.find(d => d.name === name)!;
      model = generateDungeon({ seed: spec.seed, ...(spec.theme && { theme: spec.theme }), tags: spec.tags, floors: 1 });
      models.set(name, model);
    }
    return model;
  }

  function thumbnail(model: DungeonModel, style: DungeonStyle, view: DungeonView, size: typeof CARD): OffscreenCanvas {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const { ctx, texts } = withoutText(canvas.getContext('2d')!);
    renderThumbnail(ctx, model, style, view, size);
    expect(texts).toEqual([]);
    return canvas;
  }

  function preview(model: DungeonModel, style: DungeonStyle): OffscreenCanvas {
    const pxPerCell = fittedPxPerCell(model, DEFAULT_VIEW, 1400, 1000);
    const layout = mapLayout(model, pxPerCell, DEFAULT_VIEW);
    const canvas = new OffscreenCanvas(layout.widthPx, layout.heightPx);
    const { ctx, texts } = withoutText(canvas.getContext('2d')!);
    renderMap(ctx, model, style, DEFAULT_VIEW, { pxPerCell, legibleAt: 1 });
    expect(texts).toEqual([]);
    return canvas;
  }

  function expectInked(canvas: OffscreenCanvas, style: DungeonStyle): void {
    const stats = pixelStats(canvas, parseHex(style.colors.ink));
    // Stone & shadow inks only the line where wall meets floor; Engraved cuts its rock in ink too
    expect(stats.ink).toBeGreaterThan(0.001);
    // Where the rock is solid ink, ink covers much of the picture by design
    if (style.colors.paper !== style.colors.ink) expect(stats.ink).toBeLessThan(0.6);
    expect(stats.transparent).toBe(0);
  }

  for (const { id, style } of DUNGEON_STYLES) {
    for (const { name } of DUNGEONS) {
      it(`draws the ${name} dungeon in ${id}`, async () => {
        const model = modelOf(name);
        const card = thumbnail(model, style, DEFAULT_VIEW, CARD);
        expectInked(card, style);
        await savePng(card, `styles/${name}-${id}-card`);
        const table = thumbnail(model, style, DEFAULT_VIEW, TABLE);
        expectInked(table, style);
        await savePng(table, `styles/${name}-${id}-table`);
        await savePng(preview(model, style), `styles/${name}-${id}-preview`);
        const mono = thumbnail(model, style, { ...DEFAULT_VIEW, monochrome: true }, CARD);
        expectInked(mono, style);
        await savePng(mono, `styles/${name}-${id}-mono`);
        const solid = thumbnail(model, style, { ...DEFAULT_VIEW, grid: 'solid', smallTiles: name === 'fortress' }, TABLE);
        expectInked(solid, style);
        await savePng(solid, `styles/${name}-${id}-solid`);
      });
    }
  }
});

describe('the map as SVG', () => {
  /**
   * The map saved as SVG against the map drawn on a canvas as the export draws it (`vector`: plain
   * paper, no textures, soft shadows or other pictures, holes painted as depth): the SVG, shown by
   * the browser, must be the same picture but for the edges antialiasing draws apart, and hold no text.
   */

  const PX_PER_CELL = 30;

  async function rasterise(svg: string, size: { width: number; height: number }): Promise<OffscreenCanvas> {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = new OffscreenCanvas(size.width, size.height);
      canvas.getContext('2d')!.drawImage(image, 0, 0);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** The share of pixels whose colours differ by more than a faint edge would, and a picture of where. */
  function difference(a: OffscreenCanvas, b: OffscreenCanvas): { share: number; picture: OffscreenCanvas } {
    const size = { width: a.width, height: a.height };
    const da = a.getContext('2d')!.getImageData(0, 0, size.width, size.height).data;
    const db = b.getContext('2d')!.getImageData(0, 0, size.width, size.height).data;
    const picture = new OffscreenCanvas(size.width, size.height);
    const out = picture.getContext('2d')!.createImageData(size.width, size.height);
    let differ = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!);
      const off = d > 96;
      if (off) differ++;
      out.data[i] = off ? 255 : da[i]! / 2 + 100;
      out.data[i + 1] = off ? 0 : da[i + 1]! / 2 + 100;
      out.data[i + 2] = off ? 0 : da[i + 2]! / 2 + 100;
      out.data[i + 3] = 255;
    }
    picture.getContext('2d')!.putImageData(out, 0, 0);
    return { share: differ / (da.length / 4), picture };
  }

  const CASES: readonly { name: string; seed: number; theme?: ThemeChoice; tags: string[]; styleId: DungeonStyleId }[] = [
    { name: 'default', seed: 458782179, tags: [], styleId: 'parchment' },
    { name: 'round', seed: 404, theme: 'fortress', tags: ['round', 'colonnades'], styleId: 'masonry' },
    { name: 'flooded', seed: 2024, theme: 'cavern', tags: ['flooded', 'winding'], styleId: 'slate' },
    { name: 'secret', seed: 515, tags: ['secret'], styleId: 'drafting' },
    { name: 'crumbling', seed: 202, tags: ['crumbling'], styleId: 'stipple' },
  ];

  for (const { name, seed, theme, tags, styleId } of CASES) {
    it(`draws the ${name} map in ${styleId} as the canvas does`, async () => {
      const model = generateDungeon({ seed, ...(theme && { theme }), tags, floors: 1 });
      const style = dungeonStyle(styleId);
      const size = mapLayout(model, PX_PER_CELL, DEFAULT_VIEW);
      const canvas = new OffscreenCanvas(size.widthPx, size.heightPx);
      const drawn = renderMap(canvas.getContext('2d')!, model, style, DEFAULT_VIEW, { pxPerCell: PX_PER_CELL, vector: true, openings: 'drawn' });
      const { svg, layout } = renderMapSvg(model, style, DEFAULT_VIEW, { pxPerCell: PX_PER_CELL });

      expect(layout).toEqual(drawn);
      expect(svg).not.toMatch(/NaN|undefined|Infinity|<text|@font-face/);
      const { share, picture } = difference(canvas, await rasterise(svg, { width: size.widthPx, height: size.heightPx }));
      await savePng(picture, `svg-diff-${name}-${styleId}`);
      expect(share).toBeLessThan(0.01);
    });
  }
});

describe('dungeons with terrain, for judging by eye', () => {
  /**
   * Dungeons with their terrain over seeds, boss room on and off, five-room dungeons and one to four
   * floors, written to `out/dungeon-render/v2-terrain/` for a person to judge: each floor as the
   * scene sees it (holes cut out), and a sheet of all floors side by side with each floor laid over
   * the one below, dimmed, as Atlas shows a level over the level below.
   */

  const PX = 48;

  const CASES: readonly { name: string; request: DungeonRequest; look: DungeonStyleId; view?: Partial<DungeonView> }[] = [
    { name: 'one-floor', request: { seed: 16, tags: [], floors: 1 }, look: 'parchment' },
    { name: 'one-floor-no-boss', request: { seed: 16, tags: [], floors: 1, bossRoom: false }, look: 'parchment' },
    { name: 'large-fortress', request: { seed: 777, theme: 'fortress', tags: ['large', 'colonnades'], floors: 1 }, look: 'masonry' },
    { name: 'crumbling', request: { seed: 202, tags: ['crumbling', 'medium'], floors: 1 }, look: 'stipple' },
    { name: 'wet-cavern', request: { seed: 909, theme: 'cavern', tags: ['wet'], floors: 1 }, look: 'parchment' },
    { name: 'five-room-a', request: { seed: 42, tags: [], floors: 1, fiveRoom: true }, look: 'parchment' },
    { name: 'five-room-b', request: { seed: 4242, theme: 'fortress', tags: ['colonnades'], floors: 1, fiveRoom: true }, look: 'night' },
    { name: 'five-room-c', request: { seed: 99, tags: ['crumbling'], floors: 1, fiveRoom: true }, look: 'drafting' },
    { name: 'two-floors', request: { seed: 31, tags: [], floors: 2 }, look: 'parchment' },
    { name: 'three-floors', request: { seed: 404, tags: ['deep'], floors: 3 }, look: 'parchment' },
    { name: 'four-floors', request: { seed: 1121, tags: ['large'], floors: 4 }, look: 'parchment' },
    // Rising stacks: the entrance floor is the lowest; a minstrels' gallery, murder holes in a gate chamber, a stair well and a light well look down into it.
    { name: 'fortress-rising-3f', request: { seed: 11, theme: 'fortress', tags: [], floors: 3 }, look: 'masonry' },
    { name: 'mansion-rising-3f', request: { seed: 5, theme: 'mansion', tags: [], floors: 3 }, look: 'parchment' },
    { name: 'four-floors-mono', request: { seed: 515, tags: ['crumbling'], floors: 4 }, look: 'slate', view: { monochrome: true } },
    // A sweep of seeds over every floor count, a boss room or none, and five-room dungeons.
    ...[1, 2, 3, 4].flatMap((floors) =>
      [11, 23, 37].map((seed) => ({ name: `sweep-${floors}f-${seed}`, request: { seed: seed * 1013 + floors, tags: [], floors, bossRoom: seed !== 23 }, look: 'parchment' as const })),
    ),
    ...[7, 8, 9, 10].map((seed) => ({ name: `sweep-five-room-${seed}`, request: { seed: seed * 977, ...(seed % 2 ? { theme: 'fortress' as const } : {}), tags: seed % 2 ? ['colonnades'] : ['wet'], floors: 1, fiveRoom: true }, look: 'masonry' as const })),
  ];

  function floorCanvas(model: DungeonModel, look: DungeonStyleId, view: DungeonView, floor: number): OffscreenCanvas {
    const layout = mapLayout(model, PX, view);
    const canvas = new OffscreenCanvas(layout.widthPx, layout.heightPx);
    const { ctx, texts } = withoutText(canvas.getContext('2d')!);
    renderMap(ctx, model, dungeonStyle(look), view, { pxPerCell: PX, floor });
    expect(texts).toEqual([]);
    return canvas;
  }

  /** All floors side by side, each over the floor physically below it, dimmed, where it is cut. */
  function sheet(model: DungeonModel, floors: readonly OffscreenCanvas[]): OffscreenCanvas {
    const first = floors[0]!;
    const gap = 24;
    const out = new OffscreenCanvas(first.width * floors.length + gap * (floors.length - 1), first.height);
    const ctx = out.getContext('2d')!;
    floors.forEach((canvas, k) => {
      const x = k * (first.width + gap);
      const below = floors[floorBelow(stackOf(model), k) ?? -1];
      ctx.fillStyle = '#111111';
      ctx.fillRect(x, 0, first.width, first.height);
      if (below) {
        ctx.globalAlpha = 0.6;
        ctx.drawImage(below, x, 0);
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(canvas, x, 0);
    });
    return out;
  }

  for (const { name, request, look, view: change } of CASES) {
    it(`draws ${name}`, async () => {
      const view: DungeonView = { ...DEFAULT_VIEW, ...change };
      const model = generateDungeon(request);
      const floors = model.floors.map((_, index) => floorCanvas(model, look, view, index));
      await savePng(sheet(model, floors), `v2-terrain/${name}`);
    });
  }
});

describe('glyph sheets', () => {
  /**
   * Every family's pieces on sheets of every look (`glyphSheets/<family>.ts`, style guide §10):
   * at play zoom (150 px a cell) with a token on a piece, at 100 px, at 300 px with every piece at
   * four turns, at 24 px (the thumbnail), in monochrome and as SVG, into
   * `out/dungeon-render/glyph-sheets/<family>/`. `VITE_GLYPH_FAMILY=<family>` draws one family.
   * Each piece is also drawn alone, to hold its ink to its footprint, its outline apart from its
   * floor and its paths in the SVG.
   */

  const SPECIMENS = Object.entries(import.meta.glob<{ SPECIMEN: GlyphSpecimen }>('./glyphSheets/*.ts', { eager: true }))
    .filter(([path]) => !path.endsWith('/types.ts'))
    .map(([, module]) => module.SPECIMEN)
    .filter(specimen => !import.meta.env.VITE_GLYPH_FAMILY || specimen.family === import.meta.env.VITE_GLYPH_FAMILY);

  const LOOKS: readonly DungeonStyleId[] = DUNGEON_STYLES.map(entry => entry.id);
  /** The first props, drawn before the families: the bar the families are held to, measured but not held to the families' rules. */
  const FIRST_PROPS = new Set<string>(FIRST_PROP_KINDS);
  const SHEET: DungeonView = { ...DEFAULT_VIEW };
  /** A piece drawn alone shows its own ink only: no shadow, occlusion or grid. */
  const ALONE: DungeonView = { ...DEFAULT_VIEW, shadow: false, grid: 'off' };
  const CLOSE_PX = 300;
  /** Pixels at the edge of a piece's ink taken as its outline: about an outline's width at 150 px a cell, and its antialiasing. */
  const OUTLINE_RING = 3;
  /** The most pixels one close sheet holds; a taller one is written in bands. */
  const CLOSE_PIXELS = 15_000_000;

  function out(specimen: GlyphSpecimen, name: string): string {
    return `glyph-sheets/${specimen.family}/${name}`;
  }

  function keepText(drawn: Drawn, texts: string[]): Drawn {
    texts.push(...drawn.texts);
    return drawn;
  }

  /** The sheet at 150 px with a token over the first piece, and the same at 100 px, 24 px and in monochrome. */
  async function writeSheets(specimen: GlyphSpecimen, room: SheetRoom, look: DungeonStyleId, texts: string[], failures: string[]): Promise<void> {
    const style = dungeonStyle(look);
    const sheet = keepText(drawRoom(room.model, style, SHEET, 150, room.w, room.h), texts);
    const first = room.placed.find(p => !FIRST_PROPS.has(p.piece.kind) || specimen.family === 'reference');
    if (first) drawToken(sheet.canvas.getContext('2d')!, (first.prop.x - sheet.origin.x) * 150, (first.prop.y - sheet.origin.y) * 150, 150 * 0.42, '#2e86c1');
    await savePng(sheet.canvas, out(specimen, look));
    await savePng(keepText(drawRoom(room.model, style, SHEET, 100, room.w, room.h), texts).canvas, out(specimen, `${look}-100`));
    await savePng(keepText(drawRoom(room.model, style, SHEET, 24, room.w, room.h), texts).canvas, out(specimen, `${look}-24`));
    const mono = keepText(drawRoom(room.model, style, { ...SHEET, monochrome: true }, 150, room.w, room.h), texts);
    await savePng(mono.canvas, out(specimen, `${look}-mono`));
    const off = offMonochrome(mono.canvas, style);
    if (off > 0) failures.push(`${look}: ${(off * 100).toFixed(3)} % of the monochrome sheet is no mix of ink, paper, white and black`);
    const { svg } = renderMapSvg(room.model, style, SHEET, { pxPerCell: 30 });
    if (/<text/.test(svg)) texts.push('<text> in the SVG');
    await commands.writeFile(`${RENDER_OUT}/${out(specimen, look)}.svg`, svg);
  }

  /** Every piece at four turns at 300 px, in bands that each fit what the browser can hand over. */
  async function writeClose(specimen: GlyphSpecimen, look: DungeonStyleId, texts: string[]): Promise<void> {
    const room = turnsRoom(specimen.pieces);
    const rows = Math.max(1, Math.floor(CLOSE_PIXELS / ((room.w + 2) * CLOSE_PX * CLOSE_PX)));
    for (let top = 0, band = 1; top < room.h + 2; top += rows, band++) {
      const drawn = keepText(drawWindow(room.model, dungeonStyle(look), SHEET, CLOSE_PX, { x: -1, y: top - 1, cells: room.w + 2, rows: Math.min(rows, room.h + 2 - top) }), texts);
      await savePng(drawn.canvas, out(specimen, band === 1 ? `${look}-close` : `${look}-close-${band}`));
    }
  }

  /** How far a piece drawn alone reaches past its footprint, and how far its outline lies from its floor. */
  function measure(piece: SpecimenPiece, look: DungeonStyleId, view: DungeonView, texts: string[]): { reach: number; contrast: number } {
    const style = dungeonStyle(look);
    const room = aloneRoom(piece);
    const alone = keepText(drawRoom(room.model, style, view, 150, room.w, room.h), texts);
    const ink = inkMask(alone, drawRoom(room.empty, style, view, 150, room.w, room.h));
    return { reach: farthestInk(alone, ink.mask, room.placed[0]!), contrast: outlineContrast(alone, ink, OUTLINE_RING) };
  }

  const referenceContrasts = new Map<string, number>();

  /**
   * The outline contrast a piece must reach in a look: the plan's 40, or what the first props reach
   * there (their middle), where the look's own colours allow no more (the dark looks ink a piece in
   * a deep shade of its fill, close to a dark floor).
   */
  function contrastLimit(look: DungeonStyleId, view: DungeonView): number {
    const key = `${look}:${view.monochrome}`;
    if (!referenceContrasts.has(key)) {
      const contrasts = FIRST_PROP_KINDS.map(kind => measure({ kind, rotation: 0 }, look, view, []).contrast).sort((a, b) => a - b);
      referenceContrasts.set(key, contrasts[Math.floor(contrasts.length / 2)]!);
    }
    return Math.min(OUTLINE_CONTRAST, referenceContrasts.get(key)!);
  }

  /** Each piece alone, in colour and monochrome: its ink within its footprint, its outline apart from its floor, its paths in the SVG; the numbers into `<look>-checks.txt`. */
  async function checkPieces(specimen: GlyphSpecimen, look: DungeonStyleId, texts: string[], failures: string[]): Promise<void> {
    const style = dungeonStyle(look);
    const mono: DungeonView = { ...ALONE, monochrome: true };
    const limits = { colour: contrastLimit(look, ALONE), mono: contrastLimit(look, mono) };
    const report = [`outline limit ${limits.colour.toFixed(1)}, monochrome ${limits.mono.toFixed(1)}`, 'piece\tink past footprint (cells)\toutline from floor\tin monochrome\tSVG paths'];
    for (const piece of specimen.pieces) {
      const name = `${piece.kind} at ${Math.round((piece.rotation * 180) / Math.PI)}°${piece.size ? ` × ${piece.size.along}` : ''}`;
      const colour = measure(piece, look, ALONE, texts);
      const grey = measure(piece, look, mono, texts);
      const room = aloneRoom(piece);
      const paths = pathCount(renderMapSvg(room.model, style, ALONE, { pxPerCell: 30 }).svg) - pathCount(renderMapSvg(room.empty, style, ALONE, { pxPerCell: 30 }).svg);
      report.push(`${name}\t${colour.reach.toFixed(3)}\t${colour.contrast.toFixed(1)}\t${grey.contrast.toFixed(1)}\t${paths}`);
      if (paths <= 0) failures.push(`${look}: ${name}: no path in the SVG`);
      if (FIRST_PROPS.has(piece.kind)) continue;
      if (colour.reach > FOOTPRINT_SLACK) failures.push(`${look}: ${name}: ink ${colour.reach.toFixed(3)} cells past its footprint`);
      if (colour.contrast < limits.colour) failures.push(`${look}: ${name}: outline ${colour.contrast.toFixed(1)} from its floor, under ${limits.colour.toFixed(1)}`);
      if (grey.contrast < limits.mono) failures.push(`${look}: ${name}: outline in monochrome ${grey.contrast.toFixed(1)} from its floor, under ${limits.mono.toFixed(1)}`);
    }
    await commands.writeFile(`${RENDER_OUT}/${out(specimen, `${look}-checks`)}.txt`, `${report.join('\n')}\n`);
  }

  it('has a specimen for every family it is asked for', () => {
    expect(SPECIMENS.length).toBeGreaterThan(0);
    for (const specimen of SPECIMENS) for (const piece of [...specimen.pieces, ...specimen.crowded]) expect(DRAWN_PROP_KINDS.has(piece.kind), piece.kind).toBe(true);
  });

  for (const specimen of SPECIMENS) {
    for (const look of LOOKS) {
      it(`draws the ${specimen.family} family in ${look}`, async () => {
        const texts: string[] = [];
        const failures: string[] = [];
        if (specimen.pieces.length || specimen.crowded.length) {
          const room = sheetRoom(specimen.pieces, specimen.crowded, specimen.family === 'reference');
          await writeSheets(specimen, room, look, texts, failures);
          await writeClose(specimen, look, texts);
          await checkPieces(specimen, look, texts, failures);
        }
        for (const scene of specimen.scenes ?? []) {
          const model = scene.model();
          const whole = drawWhole(model, look, SHEET, scene.floor);
          await savePng(whole, out(specimen, `${scene.name}-${look}`));
          if (scene.window) await savePng(keepText(drawWindow(model, dungeonStyle(look), SHEET, 150, scene.window, scene.floor), texts).canvas, out(specimen, `${scene.name}-${look}-window`));
        }
        expect(texts, 'draws no text').toEqual([]);
        expect(failures).toEqual([]);
      });
    }
  }
});

describe('a house drawn with its walls on cell edges', () => {
  /**
   * A house's walls on cell edges in both painters: the scene's walls lie on drawn ink, inner walls
   * as well as outer ones, and each window cuts its outer wall, so the wall's ink is gone over the
   * window's embrasure, where the window's own sill, board and frame stand.
   */

  const PX = 120;
  const LOOKS: readonly DungeonStyleId[] = ['parchment', 'print', 'night'];

  for (const look of LOOKS) {
    it(`puts walls on ink and cuts the windows (${look})`, async () => {
      const model = edgeHouse();
      const style = dungeonStyle(look);
      const layout = mapLayout(model, PX, DEFAULT_VIEW);
      const canvas = new OffscreenCanvas(layout.widthPx, layout.heightPx);
      const { ctx, texts } = withoutText(canvas.getContext('2d')!);
      renderMap(ctx, model, style, DEFAULT_VIEW, { pxPerCell: PX });
      expect(texts).toEqual([]);
      await savePng(canvas, `house/edge-${look}`);
      const picture: Picture = { data: canvas.getContext('2d')!.getImageData(0, 0, layout.widthPx, layout.heightPx).data, width: layout.widthPx, height: layout.heightPx };
      const mask = inkPixels(picture, parseHex(paletteOf(style, DEFAULT_VIEW).ink));
      const placement = { originCell: layout.originCell, pxPerCell: PX };
      const walls = Object.values(dungeonWalls(model, style, DEFAULT_VIEW, placement).walls);
      const solid = walls.filter((wall) => wall.type === 'solid' && wall.blocks === undefined);
      // The sides of a secret door's doorway are no drawn walls: the map draws the wall unbroken there.
      const rooms = new Map(model.floors[0]!.rooms.map((room) => [room.id, room]));
      const house = houseCells(model.floors[0]!);
      const secret = model.floors[0]!.doors.filter((door) => door.kind === 'secret').map((door) => doorwayShape(door, rooms, house));
      const inSecret = (p: { x: number; y: number }): boolean => {
        const c = { x: p.x / PX + layout.originCell.x, y: p.y / PX + layout.originCell.y };
        return secret.some((r) => c.x >= r.x - 0.05 && c.x <= r.x + r.w + 0.05 && c.y >= r.y - 0.05 && c.y <= r.y + r.h + 0.05);
      };
      const far = wallsOnInk(solid, mask, picture).filter((s) => s.distance > 3 && !inSecret(s.at));
      expect(far.slice(0, 5)).toEqual([]);
      const toPx = (p: { x: number; y: number }): { x: number; y: number } => ({ x: (p.x - layout.originCell.x) * PX, y: (p.y - layout.originCell.y) * PX });
      for (const window of model.floors[0]!.windows!) {
        const [a, b] = windowSpan(window);
        // In the embrasure between the window board and the frame, where the wall's joints, hatching or ink would show were it not cut.
        const off = -(OUTER_WALL / 2 - 0.07);
        const probes = [0.3, 0.5, 0.7].map((t) => toPx({ x: a.x + (b.x - a.x) * t + window.dir.x * off, y: a.y + (b.y - a.y) * t + window.dir.y * off }));
        for (const p of probes) expect(nearestInk(mask, picture, p, 1), `${look}: window at ${window.x},${window.y}`).toBe(Infinity);
      }
    });
  }
});
