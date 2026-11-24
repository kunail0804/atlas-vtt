import { describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import type { CellPoint, DungeonModel, DungeonRequest, TerrainDrop, VerticalKind } from '../../src/app/dungeons/model';
import { crayonBox } from '../../src/app/dungeons/render/crayon/crayonBox';
import { visibleDungeon, type VisibleDungeon } from '../../src/app/dungeons/render/visibleDungeon';
import { DEFAULT_VIEW, type ArtDirection, type DungeonStyle } from '../../src/app/dungeons/style';
import { DUNGEON_STYLES, dungeonStyle, type DungeonStyleId } from '../../src/app/dungeons/styleCatalog';
import { draft } from '../../src/app/dungeons/terrain/catalog';
import { addRoom, emptyModel } from '../fixtures/dungeonModelBuilder';
import { savePng, withoutText } from './dungeonRenderHarness';
import { drawWindow, inkMask, type Drawn, pathCount } from './glyphSheetChecks';
import { renderMapSvg, renderMap } from '../../src/app/dungeons/render/renderMap';
import { generateDungeon } from '../../src/app/dungeons/generate';
import { mapLayout } from '../../src/app/dungeons/render/layoutSize';
import { parseHex, paletteOf, luminance } from '../../src/app/dungeons/render/palette';
import { vellumColours } from '../../src/app/dungeons/render/vellum';
import { groundsLayout } from '../../src/app/dungeons/render/grounds/groundsShapes';
import { wayCentre, wayPoint, wayStrength, groundDistance, type WayOut, wayExtent } from '../../src/app/dungeons/render/cave/mouth/wayOut';
import { type Vec, shapeRings, pointInPolygon } from '../../src/app/dungeons/render/geometry';
import { ART_DUNGEONS } from './dungeonArtSheets';
import { inkMask as inkPixels, type Picture, nearestInk } from './dungeonFidelityChecks';
import { mouthsOf, type Mouth } from '../../src/app/dungeons/render/art/mouths';
import { unionRings } from '../../src/app/dungeons/render/clipShapes';
import type { CaveWayPart } from '../../src/app/dungeons/render/cave/caveArt';
import { CAVE_WAYS } from '../../src/app/dungeons/render/cave/ways';
import { AVEN_CELL, WAY_SPOTS, caveVeinWaysModel } from './caveVeinWays';

async function pngOf(canvas: OffscreenCanvas): Promise<string> {
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const PAINTERS: Record<ArtDirection, string> = { stone: 'parchment', engraved: 'print', crayon: 'crayon' };
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

describe('chasms on a cave floor', () => {
  /**
   * A bottomless chasm or shaft on a cave's floor is a crack in the rock: its outline traced through
   * its cells and rounded, so no edge runs straight along a cell line for long, and never more than
   * `REACH` cells past its cells, since the scene's walls are cut from the cells. A built floor's
   * holes are held to the picture they had before: `VITE_CHASM_REFERENCE=write` writes that picture
   * of every look to `out/chasm-reference/`, and every later run compares with it, pixel for pixel.
   * Pictures go to `out/dungeon-render/chasm/`; what a 20-cell chasm costs per painter, on either floor, to
   * `out/perf-glyph/caveChasm.txt`.
   */

  const PX = 100;
  const REFERENCE = 'out/chasm-reference';
  const WINDOW = { x: -1, y: -1, cells: 16, rows: 12 };
  /** How far past its cells a hole's drawing may reach, in cells. */
  const REACH = 0.3;
  /** The longest run of a hole's edge along one cell line, in cells. */
  const STRAIGHT = 2;

  /** A chasm of twelve cells stepping across the room, with straight runs of three and four cells along cell lines. */
  const CHASM: CellPoint[] = [
    ...[3, 4, 5].map((x) => ({ x, y: 4 })),
    ...[3, 4, 5, 6, 7].map((x) => ({ x, y: 5 })),
    ...[6, 7, 8, 9].map((x) => ({ x, y: 6 })),
  ];
  const SHAFT: CellPoint[] = [{ x: 11, y: 2 }];

  function holeModel(cave: boolean, chasm = CHASM, holes = true): DungeonModel {
    const model = emptyModel(71);
    const floor = model.floors[0]!;
    if (cave) {
      model.theme = 'cavern';
      floor.cave = { lane: [], heights: [0], faults: [], basins: [], streams: [], dams: [] };
    }
    addRoom(floor, { x: 0, y: 0, w: 15, h: 11 });
    if (holes) {
      floor.terrain.push({ id: 0, ...draft('chasm', 0, chasm), opening: { bottom: null, link: 0 } });
      floor.terrain.push({ id: 1, ...draft('shaft', 0, SHAFT), opening: { bottom: null, link: 1 } });
    }
    return model;
  }

  /** Pixels of a canvas that differ from a PNG, read back through the browser's decoder. */
  async function differingPixels(canvas: OffscreenCanvas, png: string): Promise<number> {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
    if (bitmap.width !== canvas.width || bitmap.height !== canvas.height) return Infinity;
    const decoded = new OffscreenCanvas(bitmap.width, bitmap.height);
    decoded.getContext('2d')!.drawImage(bitmap, 0, 0);
    const x = decoded.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data;
    // Through a PNG, so the canvas is compared as it is written.
    const roundTrip = await createImageBitmap(await canvas.convertToBlob({ type: 'image/png' }));
    const again = new OffscreenCanvas(bitmap.width, bitmap.height);
    again.getContext('2d')!.drawImage(roundTrip, 0, 0);
    const y = again.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let differ = 0;
    for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3]) differ++;
    return differ;
  }

  /** How far a point lies outside the cells, in cells; 0 inside. */
  function outside(cells: readonly CellPoint[], x: number, y: number): number {
    let best = Infinity;
    for (const c of cells) {
      const dx = Math.max(c.x - x, 0, x - c.x - 1);
      const dy = Math.max(c.y - y, 0, y - c.y - 1);
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  }

  /** The mask with every pocket the outside cannot reach filled: the drawing's whole area, its inner hatching no edge. */
  function filled(mask: Uint8Array, w: number, h: number): Uint8Array {
    const reached = new Uint8Array(w * h);
    const stack: number[] = [];
    const visit = (i: number): void => {
      if (mask[i] === 0 && reached[i] === 0) {
        reached[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < w; x++) {
      visit(x);
      visit((h - 1) * w + x);
    }
    for (let y = 0; y < h; y++) {
      visit(y * w);
      visit(y * w + w - 1);
    }
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w;
      if (x > 0) visit(i - 1);
      if (x < w - 1) visit(i + 1);
      if (i >= w) visit(i - w);
      if (i < w * (h - 1)) visit(i + w);
    }
    return reached.map((r) => 1 - r);
  }

  /** The cell a pixel's middle lies in, as world coordinates. */
  const worldOf = (drawn: Drawn, i: number): { x: number; y: number } => ({
    x: drawn.origin.x + ((i % drawn.canvas.width) + 0.5) / drawn.px,
    y: drawn.origin.y + (Math.floor(i / drawn.canvas.width) + 0.5) / drawn.px,
  });

  /** How far either way of one cell line an edge may wobble and still run along it, in cells: a chiselled lip's wobble. */
  const BAND = 0.06;

  /**
   * The longest stretch, in cells, over which the drawing's edges facing up or down stay within
   * `BAND` of one pixel row, or those facing left or right of one column: a staircase of cells keeps
   * whole cell sides straight however its lip is chiselled.
   */
  function longestStraightEdge(mask: Uint8Array, w: number, h: number, px: number): { cells: number; at: string } {
    const on = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]!);
    const band = Math.round(BAND * px);
    let longest = 0;
    let at = '';
    for (const across of [false, true]) {
      const [lines, along] = across ? [w, h] : [h, w];
      const edge = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (on(x, y) === 1 && (across ? on(x - 1, y) === 0 || on(x + 1, y) === 0 : on(x, y - 1) === 0 || on(x, y + 1) === 0)) edge[y * w + x] = 1;
        }
      }
      for (let line = 0; line < lines; line++) {
        let run = 0;
        for (let k = 0; k < along; k++) {
          let near = false;
          for (let o = Math.max(0, line - band); o <= Math.min(lines - 1, line + band) && !near; o++) near = edge[across ? k * w + o : o * w + k] === 1;
          run = near ? run + 1 : 0;
          if (run > longest) [longest, at] = [run, across ? `column ${line} to row ${k}` : `row ${line} to column ${k}`];
        }
      }
    }
    return { cells: longest / px, at };
  }

  it('draws a built floor\'s holes as they were, in every look', async () => {
    const write = (import.meta.env as Record<string, string | undefined>).VITE_CHASM_REFERENCE === 'write';
    const changed: string[] = [];
    for (const { id: look } of DUNGEON_STYLES) {
      const drawn = drawWindow(holeModel(false), dungeonStyle(look), DEFAULT_VIEW, PX, WINDOW);
      await savePng(drawn.canvas, `chasm/built-${look}`);
      if (write) {
        await commands.writeFile(`${REFERENCE}/built-${look}.png`, await pngOf(drawn.canvas), 'base64');
        continue;
      }
      const differ = await differingPixels(drawn.canvas, await commands.readFile(`${REFERENCE}/built-${look}.png`, 'base64'));
      if (differ > 0) changed.push(`${look}: ${differ} pixels differ`);
    }
    expect(changed).toEqual([]);
  });

  it(`keeps a cave's chasm and shaft within ${REACH} cells of their cells, their edges off the cell lines`, async () => {
    const problems: string[] = [];
    for (const [painter, look] of Object.entries(PAINTERS)) {
      const style = dungeonStyle(look);
      const drawn = drawWindow(holeModel(true), style, DEFAULT_VIEW, PX, WINDOW);
      await savePng(drawn.canvas, `chasm/cave-${painter}`);
      const empty = drawWindow(holeModel(true, CHASM, false), style, DEFAULT_VIEW, PX, WINDOW);
      const { mask } = inkMask(drawn, empty);
      const cells = [...CHASM, ...SHAFT];
      let farthest = 0;
      mask.forEach((on, i) => {
        if (!on) return;
        const p = worldOf(drawn, i);
        farthest = Math.max(farthest, outside(cells, p.x, p.y));
      });
      const straight = longestStraightEdge(filled(mask, drawn.canvas.width, drawn.canvas.height), drawn.canvas.width, drawn.canvas.height, PX);
      if (farthest > REACH) problems.push(`${painter}: drawn ${farthest.toFixed(2)} cells past its cells`);
      if (straight.cells > STRAIGHT) problems.push(`${painter}: an edge runs ${straight.cells.toFixed(2)} cells along a cell line, at pixel ${straight.at}`);
    }
    expect(problems).toEqual([]);
  });
});

describe('rubble fields', () => {
  /**
   * A rubble field on a cave floor is one ragged patch, its tint fading at the edge, where a built
   * floor keeps its field of whole cells. A built floor's field is held to the picture it had
   * before the cave's was drawn: `VITE_RUBBLE_REFERENCE=write` writes that picture of every look to
   * `out/rubble-reference/`, and every later run compares with it, pixel for pixel. Pictures of both
   * go to `out/dungeon-render/rubble-field/`; what a 70-cell field costs per painter, whole on
   * either floor and its patch alone, to `out/perf-glyph/rubbleField.txt`.
   */

  const PX = 100;
  const REFERENCE = 'out/rubble-reference';
  const WINDOW = { x: -1, y: -1, cells: 16, rows: 12 };
  const FIELD_CELLS = 70;

  /** A ragged field of `count` cells grown from the room's middle, with a few cells left out for the heaps that stand in it. */
  function fieldCells(count: number): CellPoint[] {
    const heaps = new Set(['6,4', '9,6', '5,7']);
    const cells: CellPoint[] = [];
    for (let r = 0; cells.length < count && r < 10; r++) {
      for (let y = 5 - r; y <= 5 + r; y++) {
        for (let x = 7 - r; x <= 7 + r; x++) {
          if (cells.length >= count || x < 1 || y < 1 || x > 13 || y > 9) continue;
          // A wobbling boundary: farther along one diagonal than the other.
          if (Math.abs(x - 7) + Math.abs(y - 5) * 1.4 + ((x * 7 + y * 3) % 3) * 0.6 > r + 1) continue;
          const key = `${x},${y}`;
          if (heaps.has(key) || cells.some((c) => c.x === x && c.y === y)) continue;
          cells.push({ x, y });
        }
      }
    }
    return cells;
  }

  function fieldModel(cave: boolean): DungeonModel {
    const model = emptyModel(53);
    const floor = model.floors[0]!;
    if (cave) {
      model.theme = 'cavern';
      floor.cave = { lane: [], heights: [0], faults: [], basins: [], streams: [], dams: [] };
    }
    addRoom(floor, { x: 0, y: 0, w: 15, h: 11 });
    floor.terrain.push({ id: 0, ...draft('rubble-field', 0, fieldCells(FIELD_CELLS)) });
    return model;
  }

  /** Pixels of two PNGs that differ, read back through the browser's decoder. */
  async function differingPixels(a: string, b: string): Promise<number> {
    const decode = async (png: string): Promise<Uint8ClampedArray> => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(png), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      return canvas.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [x, y] = await Promise.all([decode(a), decode(b)]);
    if (x.length !== y.length) return Infinity;
    let differ = 0;
    for (let i = 0; i < x.length; i += 4) if (x[i] !== y[i] || x[i + 1] !== y[i + 1] || x[i + 2] !== y[i + 2] || x[i + 3] !== y[i + 3]) differ++;
    return differ;
  }

  it('draws a built floor\'s field as it was, in every look', async () => {
    const write = (import.meta.env as Record<string, string | undefined>).VITE_RUBBLE_REFERENCE === 'write';
    const changed: string[] = [];
    for (const { id: look } of DUNGEON_STYLES) {
      const drawn = drawWindow(fieldModel(false), dungeonStyle(look), DEFAULT_VIEW, PX, WINDOW);
      expect(drawn.texts).toEqual([]);
      await savePng(drawn.canvas, `rubble-field/built-${look}`);
      const png = await pngOf(drawn.canvas);
      if (write) {
        await commands.writeFile(`${REFERENCE}/built-${look}.png`, png, 'base64');
        continue;
      }
      const reference = await commands.readFile(`${REFERENCE}/built-${look}.png`, 'base64');
      if (reference !== png) changed.push(`${look}: ${await differingPixels(reference, png)} pixels differ`);
    }
    expect(changed).toEqual([]);
  });

  it('draws a cave floor\'s field as one ragged patch, in every look', async () => {
    for (const { id: look } of DUNGEON_STYLES) {
      const style = dungeonStyle(look);
      const drawn = drawWindow(fieldModel(true), style, DEFAULT_VIEW, PX, WINDOW);
      expect(drawn.texts).toEqual([]);
      await savePng(drawn.canvas, `rubble-field/cave-${look}`);
      const empty = fieldModel(true);
      empty.floors[0]!.terrain = [];
      const paths = pathCount(renderMapSvg(fieldModel(true), style, DEFAULT_VIEW, { pxPerCell: 30 }).svg) - pathCount(renderMapSvg(empty, style, DEFAULT_VIEW, { pxPerCell: 30 }).svg);
      expect(paths, `${look} SVG`).toBeGreaterThan(0);
    }
  });
});

describe('crayon floors are coloured in', () => {
  /**
   * Crayon colours in every floor (`render/crayon/floors.ts`, `ground.ts`): no open floor cell of any
   * theme is left the bare paper. Each map is drawn whole; every cell of floor that nothing stands on,
   * away from walls, is read over its middle (clear of the grid's lines), and counts as coloured
   * when most of its pixels lie off the vellum's colour by more than its grain, and its strokes vary.
   * The narrow places are read too, each over a small window at its middle, clear of the walls' ink
   * and their shade: one-cell corridors, open doorways, a cave's ways out and a house's lawn.
   */

  const PX = 48;
  /** How far off the vellum a pixel must lie to be crayon, in RGB distance: the vellum's own grain and blotches stay well under it. */
  const OFF_PAPER = 14;
  /** The share of a cell's pixels off the paper for it to count as coloured. */
  const COVERED = 0.6;
  /**
   * Luminance spread a hand's strokes leave in a cell. Bare paper with pencilled joints reads 0.4 to
   * about 2.5 and a flat fill 0; coloured-in floors read 5 to 13, as the forest's meadow does (6 to 13).
   */
  const STROKES = 4;

  const CASES: [string, DungeonRequest, string[]][] = [
    ['fortress', { seed: 404, theme: 'fortress', tags: ['round', 'colonnades'], floors: 2 }, ['doorway']],
    ['cavern', { seed: 606, theme: 'cavern', tags: ['medium', 'wet'], floors: 2 }, ['corridor', 'way out']],
    ['mansion', { seed: 16, theme: 'mansion', tags: [], floors: 2 }, ['corridor', 'doorway', 'lawn']],
    ['mansion with cellar', { seed: 2, theme: 'mansion', tags: ['large'], floors: 3 }, ['lawn']],
    ['forest', { seed: 606, theme: 'forest', tags: ['medium', 'dry'], floors: 1 }, []],
  ];

  /** A narrow place's window, in cells, and the least it is from a wall's line. */
  const WINDOW = 0.3;
  const CLEAR = 0.3;
  /** The spread a window of hand strokes keeps: bare paper reads 0 to 2.9 there (beside a door's jamb), coloured floors 4.8 to 14. */
  const WINDOW_STROKES = 4;

  interface Spot {
    kind: string;
    x: number;
    y: number;
  }

  /** The middles of the narrow places of a floor: one-cell corridors, open doorways, a cave's ways out and a house's lawn. */
  function narrowSpots(dungeon: VisibleDungeon, busy: ReadonlySet<string>): Spot[] {
    const free = (x: number, y: number): boolean => !busy.has(`${Math.floor(x)},${Math.floor(y)}`);
    const spots: Spot[] = [];
    for (const room of dungeon.rooms) {
      if (room.kind !== 'corridor' || Math.min(room.w, room.h) !== 1) continue;
      for (let k = 0; k < room.w * room.h; k++) spots.push({ kind: 'corridor', x: room.x + (k % room.w) + 0.5, y: room.y + Math.floor(k / room.w) + 0.5 });
    }
    for (const door of dungeon.doors) if (door.kind === 'opening') spots.push({ kind: 'doorway', x: door.x + 0.5, y: door.y + 0.5 });
    const inside = spots.filter((s) => free(s.x, s.y) && dungeon.field.distance(s.x, s.y) <= -CLEAR);
    for (const way of dungeon.ways) {
      for (const u of [0.8, 1.2, 1.6]) {
        const p = wayPoint(way, u, wayCentre(way, u));
        if (dungeon.field.distance(p.x, p.y) > CLEAR && wayStrength(way, p) >= 0.5) inside.push({ kind: 'way out', ...p });
      }
    }
    const grounds = groundsLayout(dungeon.floor);
    const ways = new Set(grounds?.wayCells.map((c) => `${Math.floor(c.x)},${Math.floor(c.y)}`));
    for (const c of grounds?.lawnCells ?? []) {
      const p = { x: Math.floor(c.x) + 0.5, y: Math.floor(c.y) + 0.5 };
      if (!ways.has(`${Math.floor(c.x)},${Math.floor(c.y)}`) && dungeon.field.distance(p.x, p.y) > 1.5) inside.push({ kind: 'lawn', ...p });
    }
    return inside;
  }

  interface CellReading {
    covered: number;
    spread: number;
  }

  function readCell(data: Uint8ClampedArray, width: number, x0: number, y0: number, size: number, paper: readonly number[]): CellReading {
    let off = 0;
    let n = 0;
    let sum = 0;
    let squares = 0;
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        const i = (y * width + x) * 4;
        const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
        if (Math.hypot(r - paper[0]!, g - paper[1]!, b - paper[2]!) > OFF_PAPER) off++;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sum += l;
        squares += l * l;
        n++;
      }
    }
    const mean = sum / n;
    return { covered: off / n, spread: Math.sqrt(Math.max(0, squares / n - mean * mean)) };
  }

  const style = dungeonStyle('crayon');
  const paper = parseHex(vellumColours(style.colors.paper).inner);
  for (const [name, request, narrowKinds] of CASES) {
    it(name, () => {
      const kinds: string[] = [];
      const model = generateDungeon(request);
      const layout = mapLayout(model, PX, DEFAULT_VIEW);
      for (let floor = 0; floor < model.floors.length; floor++) {
        const canvas = new OffscreenCanvas(layout.widthPx, layout.heightPx);
        const ctx = canvas.getContext('2d')!;
        renderMap(ctx, model, style, DEFAULT_VIEW, { pxPerCell: PX, floor });
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const dungeon = visibleDungeon(model, DEFAULT_VIEW, floor);
        const f = dungeon.floor;
        const busy = new Set([
          ...f.terrain.flatMap((p) => p.cells),
          ...f.waterCells,
          ...f.stairs.flatMap((s) => Array.from({ length: s.w * s.h }, (_, k) => ({ x: s.x + (k % s.w), y: s.y + Math.floor(k / s.w) }))),
          ...[...f.props, ...f.columns].map((p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) })),
        ].map((c) => `${c.x},${c.y}`));
        const bare: string[] = [];
        let open = 0;
        const b = dungeon.bounds;
        for (let cy = Math.floor(b.minY); cy < b.maxY; cy++) {
          for (let cx = Math.floor(b.minX); cx < b.maxX; cx++) {
            // Whole cells of floor, a cell clear of any wall, whose shade and hatching would count as colour.
            if (busy.has(`${cx},${cy}`) || dungeon.field.distance(cx + 0.5, cy + 0.5) > -1) continue;
            open++;
            const at = Math.round((cx - layout.originCell.x + 0.2) * PX);
            const top = Math.round((cy - layout.originCell.y + 0.2) * PX);
            const cell = readCell(data, canvas.width, at, top, Math.round(PX * 0.6), paper);
            if (cell.covered < COVERED || cell.spread < STROKES) bare.push(`${cx},${cy} (${cell.covered.toFixed(2)}, ${cell.spread.toFixed(1)})`);
          }
        }
        const narrow = narrowSpots(dungeon, busy);
        for (const spot of narrow) {
          const size = Math.round(PX * WINDOW);
          const at = Math.round((spot.x - layout.originCell.x) * PX - size / 2);
          const top = Math.round((spot.y - layout.originCell.y) * PX - size / 2);
          const reading = readCell(data, canvas.width, at, top, size, paper);
          if (reading.spread < WINDOW_STROKES) bare.push(`${spot.kind} at ${spot.x.toFixed(1)},${spot.y.toFixed(1)} (${reading.spread.toFixed(1)})`);
        }
        kinds.push(...narrow.map((spot) => spot.kind));
        expect(open, `${name} floor ${floor}: open floor cells`).toBeGreaterThan(10);
        expect(bare, `${name} floor ${floor}: ${bare.length} of ${open} open cells and ${narrow.length} narrow places left bare`).toEqual([]);
      }
      // Each case reads the narrow places it is chosen for.
      for (const kind of narrowKinds) expect(kinds, `${name}: ${kind}`).toContain(kind);
    });
  }
});

describe('a cave\'s way out as drawn', () => {
  /**
   * A cave's way out as drawn: before every mouth the floor's tone runs on over the paper, whole near
   * the mouth and fading to the paper's by the way's end, in both painters (parchment and night are
   * Stone & shadow, print is Engraved). Engraved also thins out in a stipple: its ink lies on the
   * fading ground, never on the ground at the mouth or past the way's end.
   */

  /** Play zoom: the stipple is drawn to be read there. */
  const PX = 150;
  /** The window round a way out drawn, in cells. */
  const WINDOW = 9;
  const LOOKS: readonly DungeonStyleId[] = ['parchment', 'print', 'night'];
  const REQUESTS: readonly DungeonRequest[] = [
    ...ART_DUNGEONS.filter((d) => d.request.theme === 'cavern').map((d) => d.request),
    ...Array.from({ length: 8 }, (_, k): DungeonRequest => ({ seed: 2000 + k * 41, theme: 'cavern', tags: [['inhabited'], [], ['wet'], ['winding']][k % 4]!, floors: 1 })),
  ];

  /** A window of the map round a way out, and the cell its corner lies on. */
  function draw(model: DungeonModel, style: DungeonStyle, way: WayOut): { picture: Picture; origin: Vec } {
    const middle = wayPoint(way, way.length / 2, 0);
    const origin = { x: Math.floor(middle.x - WINDOW / 2), y: Math.floor(middle.y - WINDOW / 2) };
    const size = WINDOW * PX;
    const ctx = new OffscreenCanvas(size, size).getContext('2d')!;
    renderMap(ctx, model, style, DEFAULT_VIEW, { pxPerCell: PX, floor: 0, window: { originCell: origin, widthPx: size, heightPx: size } });
    return { picture: { data: ctx.getImageData(0, 0, size, size).data, width: size, height: size }, origin };
  }

  const luminance = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;

  /** Pixels of a strip of the way from `from` to `to` cells out, `across` cells to either side of its middle. */
  function strip(way: WayOut, origin: Vec, from: number, to: number, across: number): Vec[] {
    const out: Vec[] = [];
    for (let u = from; u <= to; u += 1 / PX) {
      for (let v = -across; v <= across; v += 1 / PX) {
        const p = wayPoint(way, u, wayCentre(way, u) + v);
        out.push({ x: Math.floor((p.x - origin.x) * PX), y: Math.floor((p.y - origin.y) * PX) });
      }
    }
    return out;
  }

  const toneOf = (picture: Picture, pixels: readonly Vec[]): number =>
    median(pixels.map(({ x, y }) => {
      const i = (y * picture.width + x) * 4;
      return luminance(picture.data[i]!, picture.data[i + 1]!, picture.data[i + 2]!);
    }));

  const inkShare = (mask: Uint8Array, picture: Picture, pixels: readonly Vec[]): number => pixels.filter(({ x, y }) => mask[y * picture.width + x]).length / pixels.length;

  /**
   * How far out the way's middle runs before the map ends, in cells: the map keeps 0.4 cells or more
   * of paper past a way's end (`WAY_INSIDE_MARGIN`), not always the 0.6 the strips beyond it read,
   * and the window shows black beyond the map, which is no paper.
   */
  function mapEnd(model: DungeonModel, way: WayOut): number {
    const { originCell, cellsWide, cellsHigh } = mapLayout(model, PX);
    const inside = (p: Vec): boolean => p.x > originCell.x && p.y > originCell.y && p.x < originCell.x + cellsWide && p.y < originCell.y + cellsHigh;
    let u = way.length;
    while (u < way.length + 1 && inside(wayPoint(way, u + 0.01, wayCentre(way, u + 0.01)))) u += 0.01;
    return u - 0.05;
  }

  let toned = 0;

  for (const request of REQUESTS) {
    it(`runs on from every mouth and fades into the paper: seed ${request.seed} [${request.tags.join(',')}]`, () => {
      const model = generateDungeon(request);
      const dungeon = visibleDungeon(model, DEFAULT_VIEW, 0);
      const distance = groundDistance(dungeon.field);
      // A way that another floor lies across gives way to it; its tone is that floor's.
      const ways = dungeon.ways.filter((way) => {
        for (let u = 0.3; u <= way.length + 1; u += 0.1) if (distance(wayPoint(way, u, wayCentre(way, u))) < Math.min(u, 2.5) - 0.3) return false;
        return true;
      });
      for (const look of LOOKS) {
        const style = dungeonStyle(look);
        const palette = paletteOf(style, DEFAULT_VIEW);
        const floor = luminance(...parseHex(palette.floor));
        for (const way of ways) {
          const { picture, origin } = draw(model, style, way);
          const mask = inkPixels(picture, parseHex(palette.ink));
          const where = `${look}, the way out at ${way.mouth.at.x}, ${way.mouth.at.y}`;
          const half = way.mouth.width / 2;
          const end = mapEnd(model, way);
          const paper = toneOf(picture, strip(way, origin, Math.min(way.length + 0.3, end - 0.3), Math.min(way.length + 0.6, end), 0.25 * half));
          const floorness = (from: number, to: number): number => (toneOf(picture, strip(way, origin, from, to, 0.25 * half)) - paper) / (floor - paper);
          if (Math.abs(floor - paper) > 8) {
            const near = floorness(0.15, 0.45);
            const middle = floorness(way.length * 0.55, way.length * 0.65);
            const last = floorness(way.length * 0.95, way.length * 1.05);
            expect(near, `${where}: the floor's tone beyond the mouth`).toBeGreaterThan(0.75);
            expect(middle, `${where}: fading halfway`).toBeLessThan(near);
            expect(last, `${where}: gone by its end`).toBeLessThan(0.12);
            expect(last, `${where}: fading towards its end`).toBeLessThan(middle);
            toned++;
          }
          if (style.direction === 'engraved') {
            const stipple = inkShare(mask, picture, strip(way, origin, way.length * 0.35, way.length * 0.95, half + 0.2));
            expect(stipple, `${where}: stipple on the fading ground`).toBeGreaterThan(0.002);
            expect(inkShare(mask, picture, strip(way, origin, 0.1, 0.4, 0.3 * half)), `${where}: ink on the ground at the mouth`).toBeLessThan(stipple / 4);
            expect(inkShare(mask, picture, strip(way, origin, way.length + 0.1, Math.min(way.length + 0.5, end), 0.3 * half)), `${where}: ink past the way's end`).toBe(0);
          }
        }
      }
    }, 120_000);
  }
  it('measures the tone of many ways out in the cases above', () => {
    expect(toned).toBeGreaterThan(30);
  });
});

describe('a cave\'s walls as drawn', () => {
  /**
   * A cave's walls as drawn: every stretch of the traced outline of its floor carries the walls' ink,
   * in both painters (parchment and night are Stone & shadow, print is Engraved), on every cavern of
   * the art sheets and on seeds of every kind. Only an entrance's mouth is open, and no wall's shadow
   * falls across it, since the ground before it is open (`mouthLane`), not rock.
   */

  const PX = 60;
  /** Ink this near a point of the outline, in pixels: the ink is centred on the outline's grown ring. */
  const INK_REACH = 4;
  /** Steps along the outline, in cells. */
  const STEP = 0.05;
  const LOOKS: readonly DungeonStyleId[] = ['parchment', 'print', 'night'];

  const REQUESTS: readonly DungeonRequest[] = [
    ...ART_DUNGEONS.filter((d) => d.request.theme === 'cavern').map((d) => d.request),
    ...Array.from({ length: 16 }, (_, k): DungeonRequest => ({ seed: 1000 + k * 37, theme: 'cavern', tags: [['secret'], ['wet'], ['inhabited'], [], ['lava'], ['winding']][k % 6]!, floors: 1 + (k % 3) })),
  ];

  function draw(model: DungeonModel, style: DungeonStyle, floor: number): Picture {
    const layout = mapLayout(model, PX, DEFAULT_VIEW);
    const ctx = new OffscreenCanvas(layout.widthPx, layout.heightPx).getContext('2d')!;
    renderMap(ctx, model, style, DEFAULT_VIEW, { pxPerCell: PX, floor });
    return { data: ctx.getImageData(0, 0, layout.widthPx, layout.heightPx).data, width: layout.widthPx, height: layout.heightPx };
  }

  /** Whether `p` lies on the mouth's own edge: the open line across its passage. */
  function onMouth(p: Vec, mouths: readonly Mouth[]): boolean {
    return mouths.some(({ at, out, width }) => {
      const along = Math.abs((p.x - at.x) * out.y - (p.y - at.y) * out.x);
      const off = Math.abs((p.x - at.x) * out.x + (p.y - at.y) * out.y);
      return off < 0.06 && along <= width / 2 + 0.06;
    });
  }

  /** Stretches of the outline longer than a fifth of a cell without ink, off every mouth, as `(x, y) length` in cells. */
  function uninked(rings: readonly (readonly Vec[])[], mask: Uint8Array, picture: Picture, origin: Vec, mouths: readonly Mouth[]): string[] {
    const inkNear = (p: Vec): boolean => nearestInk(mask, picture, { x: (p.x - origin.x) * PX, y: (p.y - origin.y) * PX }, INK_REACH) < Infinity;
    const out: string[] = [];
    for (const ring of rings) {
      let start: Vec | null = null;
      let length = 0;
      const close = (): void => {
        if (start && length > 0.2) out.push(`(${start.x.toFixed(2)}, ${start.y.toFixed(2)}) ${length.toFixed(2)}`);
        start = null;
        length = 0;
      };
      ring.forEach((a, i) => {
        const b = ring[(i + 1) % ring.length]!;
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        for (let t = 0; t < l; t += STEP) {
          const p = { x: a.x + ((b.x - a.x) * t) / l, y: a.y + ((b.y - a.y) * t) / l };
          if (onMouth(p, mouths) || inkNear(p)) close();
          else {
            start ??= p;
            length += STEP;
          }
        }
      });
      close();
    }
    return out;
  }

  const luminance = (picture: Picture, p: Vec, origin: Vec): number => {
    const i = (Math.floor((p.y - origin.y) * PX) * picture.width + Math.floor((p.x - origin.x) * PX)) * 4;
    return 0.2126 * picture.data[i]! + 0.7152 * picture.data[i + 1]! + 0.0722 * picture.data[i + 2]!;
  };

  /** How much darker the floor just inside a mouth is than the floor a cell further in, across the middle of its passage. */
  function shadeAtMouth(picture: Picture, origin: Vec, { at, out, width }: Mouth): number {
    const strip = (from: number, to: number): number[] => {
      const values: number[] = [];
      for (let d = from; d <= to; d += 1 / PX) {
        for (let s = -0.2 * width; s <= 0.2 * width; s += 1 / PX) values.push(luminance(picture, { x: at.x - out.x * d - out.y * s, y: at.y - out.y * d + out.x * s }, origin));
      }
      return values;
    };
    return median(strip(1.05, 1.2)) - median(strip(0.04, 0.12));
  }

  for (const request of REQUESTS) {
    it(`ink every stretch of the outline but the mouths: seed ${request.seed} [${request.tags.join(',')}]`, () => {
      const model = generateDungeon(request);
      const origin = mapLayout(model, PX, DEFAULT_VIEW).originCell;
      for (const look of LOOKS) {
        const style = dungeonStyle(look);
        const ink = parseHex(paletteOf(style, DEFAULT_VIEW).ink);
        model.floors.forEach((_, floor) => {
          const where = `${look}, floor ${floor}`;
          const picture = draw(model, style, floor);
          const dungeon = visibleDungeon(model, DEFAULT_VIEW, floor);
          const rings = unionRings(dungeon.floors.flatMap((shape) => shapeRings(shape, 0, PX)));
          const mouths = mouthsOf(dungeon);
          expect(uninked(rings, inkPixels(picture, ink), picture, origin, mouths), `${where}: outline without ink`).toEqual([]);
          for (const mouth of mouths) {
            expect(shadeAtMouth(picture, origin, mouth), `${where}: shadow across the mouth at ${mouth.at.x}, ${mouth.at.y}`).toBeLessThan(20);
          }
        });
      }
    }, 120_000);
  }
});

describe('rock a cave closes in on', () => {
  /**
   * Rock a cave closes in on is rock through and through, in both painters (parchment is Stone &
   * shadow, print Engraved): the rock round a loop of passages, or a stretch of rock whose way out to
   * the open lies between walls closer than the hatched band is wide, shows the band's ink in its
   * middle, never bare paper. Such rock read as holes in the map (seed 606, `cavern-limestone`), and
   * caves whose outline lay far from its box's sides were not hatched at all (`bandSeeds`).
   */

  const PX = 40;
  /** Spacing of the probe the islands are found on, in cells. */
  const STEP = 0.1;
  /** How far inside the paper the band leaves a sample lies, in cells, so the band's own edge is not read. */
  const INSET = 0.25;
  /**
   * How much wider than twice the band a neck may be, in cells, for the rock behind it to count:
   * the drawing closes necks up to 0.1 wider (`NECK_SLACK`), so rock is asked for behind necks a
   * little narrower than that and paper only beyond necks a little wider, never on the line itself.
   */
  const CLOSED_NECK = 0.05;
  const OPEN_NECK = 0.15;
  /** Half the side of the square each sample reads, in cells. */
  const WINDOW = 0.35;
  const LOOKS: readonly DungeonStyleId[] = ['parchment', 'print'];
  const REQUESTS: readonly DungeonRequest[] = [
    ...ART_DUNGEONS.filter((d) => d.request.theme === 'cavern').map((d) => d.request),
    ...Array.from({ length: 24 }, (_, k): DungeonRequest => ({ seed: 3000 + k * 53, theme: 'cavern', tags: [['winding'], [], ['wet'], ['spacious'], ['large'], ['inhabited']][k % 6]!, floors: 1 + (k % 2) })),
  ];

  /** The probe's grid over the floors with two cells round them: each point's distance from the floors, the open ground before a mouth as far as can be. */
  function probe(dungeon: VisibleDungeon): { x0: number; y0: number; w: number; h: number; distance: Float32Array } {
    const b = dungeon.bounds;
    const x0 = b.minX - 2;
    const y0 = b.minY - 2;
    const w = Math.ceil((b.maxX - b.minX + 4) / STEP);
    const h = Math.ceil((b.maxY - b.minY + 4) / STEP);
    const distance = new Float32Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const x = x0 + (i + 0.5) * STEP;
        const y = y0 + (j + 0.5) * STEP;
        // The open ground before a mouth is the paper's: it leads out.
        distance[j * w + i] = dungeon.open.some((ring) => pointInPolygon(ring, x, y)) ? Infinity : dungeon.field.distance(x, y);
      }
    }
    return { x0, y0, w, h, distance };
  }

  /** The probe's points the open paper round the map reaches without coming nearer the floors than `beyond`. */
  function openPaper({ w, h, distance }: ReturnType<typeof probe>, beyond: number): Uint8Array {
    const outside = new Uint8Array(w * h);
    const stack: number[] = [];
    for (let k = 0; k < w * h; k++) {
      const i = k % w;
      const j = (k - i) / w;
      if ((i === 0 || j === 0 || i === w - 1 || j === h - 1) && distance[k]! > beyond) {
        outside[k] = 1;
        stack.push(k);
      }
    }
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % w;
      for (const n of [k - w, k + w, i > 0 ? k - 1 : -1, i < w - 1 ? k + 1 : -1]) {
        if (n >= 0 && n < w * h && distance[n]! > beyond && !outside[n]) {
          outside[n] = 1;
          stack.push(n);
        }
      }
    }
    return outside;
  }

  /**
   * Points of rock beyond the band (`reach` from every floor) that the open paper round the map
   * cannot reach without crossing the band: what the floors and the band close in on; and, to hold
   * the reading of the picture to account, points of that open paper.
   */
  function rockBeyondBand(dungeon: VisibleDungeon, grid: ReturnType<typeof probe>, reach: number): { enclosed: Vec[]; paper: Vec[] } {
    const { x0, y0, w, h, distance } = grid;
    const b = dungeon.bounds;
    const closed = openPaper(grid, reach + CLOSED_NECK);
    const open = openPaper(grid, reach + OPEN_NECK);
    // A way out's stipple and scree lie on the paper beside it.
    const ways = dungeon.ways.map((way) => wayExtent(way, way.length + 1));
    const byAWay = (p: Vec): boolean => ways.some((e) => p.x > e.minX - 1 && p.x < e.maxX + 1 && p.y > e.minY - 1 && p.y < e.maxY + 1);
    const enclosed: Vec[] = [];
    const paper: Vec[] = [];
    for (let j = 0; j < h; j += 3) {
      for (let i = 0; i < w; i += 3) {
        const k = j * w + i;
        const d = distance[k]!;
        if (d <= reach + INSET || d === Infinity) continue;
        const p = { x: x0 + (i + 0.5) * STEP, y: y0 + (j + 0.5) * STEP };
        if (!closed[k]) enclosed.push(p);
        // Within the picture drawn, away from its edge.
        else if (open[k] && d > reach + 1 && p.x > b.minX && p.x < b.maxX && p.y > b.minY && p.y < b.maxY && (i + j) % 9 === 0 && !byAWay(p)) paper.push(p);
      }
    }
    return { enclosed, paper };
  }

  /** Share of the pixels round `p` darker than `dark`: the band's ink, never the vellum's mottling. */
  function inkAround(ctx: OffscreenCanvasRenderingContext2D, origin: Vec, p: Vec, dark: number): number {
    const size = Math.round(WINDOW * 2 * PX);
    const { data } = ctx.getImageData(Math.round((p.x - origin.x - WINDOW) * PX), Math.round((p.y - origin.y - WINDOW) * PX), size, size);
    let ink = 0;
    for (let k = 0; k < data.length; k += 4) if (luminance([data[k]!, data[k + 1]!, data[k + 2]!]) < dark) ink++;
    return ink / (data.length / 4);
  }

  /** Least share of ink a square of hatched rock shows. */
  const HATCHED = 0.02;

  let islands = 0;

  for (const request of REQUESTS) {
    it(`is drawn as rock, never paper: seed ${request.seed} [${request.tags.join(',')}]`, () => {
      const model = generateDungeon(request);
      for (let floor = 0; floor < model.floors.length; floor++) {
        const dungeon = visibleDungeon(model, DEFAULT_VIEW, floor);
        const grid = probe(dungeon);
        for (const look of LOOKS) {
          const style = dungeonStyle(look);
          const { enclosed: samples, paper: open } = rockBeyondBand(dungeon, grid, style.surround.reach);
          if (!samples.length) continue;
          const b = dungeon.bounds;
          const origin = { x: Math.floor(b.minX - 1), y: Math.floor(b.minY - 1) };
          const widthPx = Math.ceil(b.maxX + 1 - origin.x) * PX;
          const heightPx = Math.ceil(b.maxY + 1 - origin.y) * PX;
          const ctx = new OffscreenCanvas(widthPx, heightPx).getContext('2d', { willReadFrequently: true })!;
          renderMap(ctx, model, style, DEFAULT_VIEW, { pxPerCell: PX, floor, window: { originCell: origin, widthPx, heightPx } });
          const dark = luminance(parseHex(paletteOf(style, DEFAULT_VIEW).paper)) - 50;
          const bare = samples.filter((p) => inkAround(ctx, origin, p, dark) < HATCHED);
          islands += samples.length;
          const inked = open.filter((p) => inkAround(ctx, origin, p, dark) >= HATCHED);
          expect(inked.length, `${look}, floor ${floor}: open paper read as rock`).toBe(0);
          expect(bare.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`), `${look}, floor ${floor}: enclosed rock drawn as bare paper`).toEqual([]);
        }
      }
    }, 120_000);
  }
  it('finds enclosed rock in the cases above', () => {
    expect(islands).toBeGreaterThan(50);
  });
});

describe('the ways between caves as drawn', () => {
  /**
   * The ways between caves as drawn, in each painter (parchment is Stone, print Engraved, crayon
   * Crayon): each way's marks lie within two cells of its door and an aven's of its cell; nothing
   * else on the map changes; a squeeze, a letterbox and a crawl keep the middle of their way clear of
   * ink; a door that names a walk draws as one without a way; and a climb within the floor stays
   * near its door cell, its rope on the higher side. A narrow way's walls close in on it
   * (`narrowPinch.ts`), and the rock's hatching follows the walls, so the marks are compared with the
   * same cave drawn without them (`withoutMarks`).
   */

  const PX = 60;
  /** The window drawn, in cells: the chamber, its passages and the rock round them. */
  const ORIGIN = { x: -1, y: -1 };
  const CELLS = 19;
  const LOOKS: readonly DungeonStyleId[] = ['parchment', 'print', 'crayon'];
  /** How far a way's drawing may reach from its cell, in cells. */
  const REACH = 2;

  interface Picture { data: Uint8ClampedArray; size: number; canvas: OffscreenCanvas }

  function draw(model: DungeonModel, look: DungeonStyleId, px = PX): Picture {
    const size = CELLS * px;
    const canvas = new OffscreenCanvas(size, size);
    const { ctx, texts } = withoutText(canvas.getContext('2d')!);
    renderMap(ctx, model, dungeonStyle(look), DEFAULT_VIEW, { pxPerCell: px, floor: 0, openings: 'drawn', window: { originCell: ORIGIN, widthPx: size, heightPx: size } });
    expect(texts).toEqual([]);
    return { data: canvas.getContext('2d')!.getImageData(0, 0, size, size).data, size, canvas };
  }

  /** The parts that draw a door's way's marks. */
  const MARK_PARTS: readonly CaveWayPart[] = ['lowWay', 'squeeze', 'letterbox', 'sumpWay', 'traverseWay', 'breakdownWay', 'climbWay'];

  /** The cave with its ways, drawn without their marks and without the aven: what the marks are drawn over. */
  function withoutMarks(look: DungeonStyleId): Picture {
    const kept = MARK_PARTS.map((part) => [part, CAVE_WAYS[part]] as const);
    for (const part of MARK_PARTS) CAVE_WAYS[part] = (): void => undefined;
    try {
      const model = caveVeinWaysModel();
      model.floors[0]!.terrain = model.floors[0]!.terrain.filter((piece) => piece.kind !== 'aven');
      return draw(model, look);
    } finally {
      for (const [part, painter] of kept) CAVE_WAYS[part] = painter!;
    }
  }

  const differs = (a: Picture, b: Picture, i: number): boolean =>
    Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!) + Math.abs(a.data[i + 2]! - b.data[i + 2]!) > 12;

  const luma = (p: Picture, i: number): number => 0.2126 * p.data[i]! + 0.7152 * p.data[i + 1]! + 0.0722 * p.data[i + 2]!;

  /**
   * Whether pixel (x, y) lies within two pixels of an edge already drawn. The browser's rasteriser
   * may place a later stroke a pixel or two otherwise when what was drawn before it changes (it picks
   * how to draw a path by what it drew before), which moves pixels along that stroke's own edges,
   * never draws anything new on open floor or rock.
   */
  function nearEdge(p: Picture, x: number, y: number): boolean {
    let lo = 255;
    let hi = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= p.size || ny >= p.size) continue;
      const l = luma(p, (ny * p.size + nx) * 4);
      lo = Math.min(lo, l);
      hi = Math.max(hi, l);
    }
    return hi - lo > 40;
  }

  /** The point in cells of pixel (x, y). */
  const cellAt = (x: number, y: number): { x: number; y: number } => ({ x: ORIGIN.x + (x + 0.5) / PX, y: ORIGIN.y + (y + 0.5) / PX });

  /** How far a point lies outside a cell's square, in cells. */
  function beyond(p: { x: number; y: number }, cell: { x: number; y: number }): number {
    const dx = Math.max(cell.x - p.x, 0, p.x - cell.x - 1);
    const dy = Math.max(cell.y - p.y, 0, p.y - cell.y - 1);
    return Math.hypot(dx, dy);
  }

  /** The pixels of a strip down the middle of a door cell, `half` cells either side of the way's line, the cell's mouths left out. */
  function middleStrip(spot: (typeof WAY_SPOTS)[number], half: number): number[] {
    const out: number[] = [];
    const { door, dir } = spot;
    for (let v = -0.4; v <= 0.4; v += 0.5 / PX) for (let u = -half; u <= half; u += 0.5 / PX) {
      const x = Math.floor((door.x + 0.5 - dir.y * u + dir.x * v - ORIGIN.x) * PX);
      const y = Math.floor((door.y + 0.5 + dir.x * u + dir.y * v - ORIGIN.y) * PX);
      out.push((y * CELLS * PX + x) * 4);
    }
    return out;
  }

  for (const look of LOOKS) {
    it(`draws every way near its door and nothing elsewhere in ${look}`, () => {
      const drawn = draw(caveVeinWaysModel(), look);
      const plain = withoutMarks(look);
      const places = [
        ...WAY_SPOTS.filter(spot => spot.way !== 'walk').map(spot => ({ name: spot.way, cell: spot.door })),
        { name: 'aven', cell: AVEN_CELL },
      ];
      const counts = new Map<string, number>(places.map(place => [place.name, 0]));
      const strays: string[] = [];
      for (let y = 0; y < drawn.size; y++) for (let x = 0; x < drawn.size; x++) {
        const i = (y * drawn.size + x) * 4;
        if (!differs(drawn, plain, i)) continue;
        const p = cellAt(x, y);
        const near = places.filter(place => beyond(p, place.cell) <= REACH);
        for (const place of near) counts.set(place.name, counts.get(place.name)! + 1);
        if (!near.length && !nearEdge(plain, x, y)) strays.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
      }
      expect(strays.slice(0, 8), `${look}: changed pixels beyond two cells of every way`).toEqual([]);
      // A narrow way's marks are small, its narrowed walls saying the rest: a crawl one short pair of roof ticks on its door cell,
      // a sump only its roof coming down into the water, which is the floor's own.
      const least: Record<string, number> = { crawl: PX / 4, squeeze: PX, letterbox: PX, sump: PX };
      for (const [name, count] of counts) expect(count, `${look} ${name}: drawn`).toBeGreaterThan(least[name] ?? PX * 2);
    });

    it(`keeps the middle of a squeeze, a letterbox and a crawl clear in ${look}`, () => {
      const drawn = draw(caveVeinWaysModel(), look);
      const plain = withoutMarks(look);
      for (const [way, half] of [['squeeze', 0.07], ['letterbox', 0.035], ['crawl', 0.12]] as const) {
        const spot = WAY_SPOTS.find(s => s.way === way)!;
        const changed = middleStrip(spot, half).filter(i => differs(drawn, plain, i)).length;
        expect(changed, `${look} ${way}: ink across the way`).toBe(0);
      }
    });

    it(`draws a door that names a walk as one without a way in ${look}`, () => {
      const plain = draw(caveVeinWaysModel(false), look);
      const model = caveVeinWaysModel(false);
      for (const door of model.floors[0]!.doors) door.way = 'walk';
      const walks = draw(model, look);
      let changed = 0;
      for (let i = 0; i < plain.data.length; i++) if (plain.data[i] !== walks.data[i]) changed++;
      expect(changed).toBe(0);
    });
  }

  /** The cave without its ways, with one aven or bottomless hole of `kind` on `cell`. */
  function withVertical(piece: 'aven' | 'shaft', cell: { x: number; y: number }, drop: TerrainDrop): DungeonModel {
    const model = caveVeinWaysModel(false);
    const floor = model.floors[0]!;
    const opening = piece === 'shaft' ? { opening: { bottom: null, link: 40 } } : {};
    floor.terrain.push({ id: floor.terrain.length, room: 0, kind: piece, name: `dungeon.terrain.${piece}`, cells: [cell], traits: { drop }, ...opening });
    return model;
  }

  /** How many pixels of the picture `model` makes differ from the plain cave's, and the farthest of them from `cell`, in cells. */
  function inked(model: DungeonModel, plain: Picture, look: DungeonStyleId, cell: { x: number; y: number }): { count: number; reach: number } {
    const drawn = draw(model, look);
    let count = 0;
    let reach = 0;
    for (let y = 0; y < drawn.size; y++) for (let x = 0; x < drawn.size; x++) {
      if (!differs(drawn, plain, (y * drawn.size + x) * 4)) continue;
      count++;
      reach = Math.max(reach, beyond(cellAt(x, y), cell));
    }
    return { count, reach };
  }

  for (const look of LOOKS) {
    it(`opens a chimney narrower than a shaft and a vertical squeeze narrower still, overhead and underfoot, in ${look}`, () => {
      const plain = draw(caveVeinWaysModel(false), look);
      const hole = { x: 6, y: 8 };
      for (const [piece, cell] of [['aven', AVEN_CELL], ['shaft', hole]] as const) {
        const [shaft, chimney, squeeze] = (['shaft', 'chimney', 'squeeze'] as const).map(kind => inked(withVertical(piece, cell, { depth: 30, kind }), plain, look, cell));
        expect(chimney!.count, `${look} ${piece}: a chimney against a shaft`).toBeLessThan(shaft!.count * 0.85);
        expect(squeeze!.count, `${look} ${piece}: a squeeze against a chimney`).toBeLessThan(chimney!.count * 0.9);
        expect(squeeze!.count, `${look} ${piece}: a squeeze is drawn`).toBeGreaterThan(PX);
        for (const way of [shaft, chimney, squeeze]) expect(way!.reach, `${look} ${piece}: ink near its cell`).toBeLessThanOrEqual(REACH);
      }
    });
  }

  /** The cave without its ways, its walk turned into a climb of `kind` (a pitch's width or a chimney's), rising towards its passage unless it `descends`. */
  function withClimb(kind: VerticalKind, descends: boolean): DungeonModel {
    const model = caveVeinWaysModel(false);
    const spot = WAY_SPOTS.find(s => s.way === 'walk')!;
    const door = model.floors[0]!.doors.find(d => d.x === spot.door.x && d.y === spot.door.y)!;
    door.way = 'climb';
    door.width = kind === 'shaft' ? 8 : 3;
    door.drop = { depth: 20, kind };
    if (descends) door.descends = true;
    return model;
  }

  /** How far past its door cell a climb's ink may reach, in cells: its rubble spreads up to 0.8 cells past its band. */
  const CLIMB_REACH = 1.2;

  for (const look of LOOKS) {
    it(`draws a climb near its door cell, its rope on the upper side and a chimney with less than a pitch, in ${look}`, () => {
      const plain = draw(caveVeinWaysModel(false), look);
      const { door } = WAY_SPOTS.find(s => s.way === 'walk')!;
      const [pitch, chimney] = (['shaft', 'chimney'] as const).map(kind => inked(withClimb(kind, false), plain, look, door));
      expect(chimney!.count, `${look}: a chimney against a pitch`).toBeLessThan(pitch!.count);
      for (const way of [pitch, chimney]) {
        expect(way!.count, `${look}: a climb is drawn`).toBeGreaterThan(PX);
        expect(way!.reach, `${look}: ink beside its cell`).toBeLessThanOrEqual(CLIMB_REACH);
      }
      // The walk runs south from the chamber into its passage: the rope is tied on whichever side lies higher.
      // A pitch differs from a chimney by its rope and the ring it is tied to, so where the two differ is where the rope lies.
      for (const descends of [false, true]) {
        const roped = draw(withClimb('shaft', descends), look);
        const braced = draw(withClimb('chimney', descends), look);
        let north = 0;
        let south = 0;
        for (let y = 0; y < roped.size; y++) for (let x = 0; x < roped.size; x++) {
          if (!differs(roped, braced, (y * roped.size + x) * 4)) continue;
          const p = cellAt(x, y);
          if (p.y < door.y + 0.5) north++;
          else south++;
        }
        expect(descends ? north > south : south > north, `${look}: rope on the upper side (descends ${descends}: ${north} north, ${south} south)`).toBe(true);
      }
    });
  }
});
