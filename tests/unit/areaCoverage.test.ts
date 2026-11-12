import { describe, expect, it } from 'vitest';
import { cellsCoveredBy, type AreaShape } from '../../src/app/grid/areaCoverage';
import type { GridGeometry } from '../../src/app/grid/gridDistance';
import { axialToPixel, createHexLayout, pixelToAxial, type HexGridType, type Point } from '../../src/app/grid/hexGeometry';
import { axialKey } from '../../src/app/grid/hexLattice';

const SQUARE: GridGeometry = { type: 'square', size: 10, offsetX: 0, offsetY: 0 };
const HEX_TYPES: readonly HexGridType[] = ['hex-vertical', 'hex-horizontal'];

const keys = (area: AreaShape, grid: GridGeometry): string[] => cellsCoveredBy(area, grid).map((cell) => cell.key).sort();
const cone = (apex: Point, toward: Point, angle: number): AreaShape => ({ kind: 'cone', apex, toward, angle });
const circle = (center: Point, radius: number): AreaShape => ({ kind: 'circle', center, radius });

describe('the cells a shape covers on a square grid', () => {
  it('counts a cell the shape covers exactly half of', () => {
    // A 90° cone from a cell's corner along its edge takes the half of the cell below its diagonal.
    expect(keys(cone({ x: 0, y: 0 }, { x: 100, y: 0 }, 90), SQUARE)).toContain('0,0');
  });

  it('leaves out a cell it covers less than half of, and counts its neighbour covered more', () => {
    // The apex a pixel above the line between them: 40.5 % of the lower cell, 59 % of the upper one.
    const covered = keys(cone({ x: 0, y: -1 }, { x: 100, y: -1 }, 90), SQUARE);
    expect(covered).not.toContain('0,0');
    expect(covered).toContain('0,-1');
  });

  it('starts a cone on the middle of a cell edge', () => {
    // From the middle of the left edge of cell 0,0: 75 % of it, 12.5 % of the cells above and below.
    const covered = keys(cone({ x: 0, y: 5 }, { x: 20, y: 5 }, 90), SQUARE);
    expect(covered).toEqual(expect.arrayContaining(['0,0', '1,0']));
    expect(covered).not.toContain('0,1');
    expect(covered).not.toContain('0,-1');
    expect(covered).not.toContain('-1,0');
  });

  it('starts a cone on a cell corner', () => {
    const covered = keys(cone({ x: 0, y: 0 }, { x: 30, y: 30 }, 90), SQUARE);
    expect(covered).toContain('0,0');
    expect(covered).not.toContain('-1,0');
    expect(covered).not.toContain('0,-1');
    expect(covered).not.toContain('-1,-1');
  });

  it('draws a 53° cone as wide as it is long', () => {
    // Half as wide at each side as it is far from its apex: the axis row is covered, the rows beside its first cells are not.
    const covered = keys(cone({ x: 0, y: 5 }, { x: 30, y: 5 }, 53.13), SQUARE);
    expect(covered).toEqual(expect.arrayContaining(['1,0', '2,0']));
    for (const outside of ['-1,0', '3,0', '0,1', '0,-1', '1,1', '1,-1']) expect(covered).not.toContain(outside);
  });

  it('counts the first cell of a cone exactly as wide as it is long, and not one a hair narrower', () => {
    // At 2·atan(1/2) the cone from the middle of the cell's edge covers exactly half of it; 53.13° is a little less.
    const exact = 2 * Math.atan(0.5) * 180 / Math.PI;
    expect(keys(cone({ x: 0, y: 5 }, { x: 30, y: 5 }, exact), SQUARE)).toContain('0,0');
    expect(keys(cone({ x: 0, y: 5 }, { x: 30, y: 5 }, 53.13), SQUARE)).not.toContain('0,0');
  });

  it('counts the four cells around a circle on their shared corner', () => {
    expect(keys(circle({ x: 0, y: 0 }, 10), SQUARE)).toEqual(['-1,-1', '-1,0', '0,-1', '0,0']);
  });

  it('counts the cells a circle around a cell centre covers', () => {
    // 1.5 cells around a centre: the cell, its eight neighbours (54 % of the corner ones) and nothing beyond.
    expect(keys(circle({ x: 5, y: 5 }, 15), SQUARE)).toEqual(['-1,-1', '-1,0', '-1,1', '0,-1', '0,0', '0,1', '1,-1', '1,0', '1,1']);
  });

  it('follows the grid offset', () => {
    expect(keys(circle({ x: 3, y: 7 }, 10), { ...SQUARE, offsetX: 3, offsetY: 7 })).toEqual(['-1,-1', '-1,0', '0,-1', '0,0']);
  });

  it('covers nothing with a shape of no size', () => {
    expect(keys(circle({ x: 5, y: 5 }, 0), SQUARE)).toEqual([]);
    expect(keys(cone({ x: 5, y: 5 }, { x: 5, y: 5 }, 90), SQUARE)).toEqual([]);
  });
});

describe.each(HEX_TYPES)('the cells a shape covers on a %s grid', (type) => {
  const grid: GridGeometry = { type, size: 70, offsetX: 0, offsetY: 0 };
  const layout = createHexLayout(type, 70, 0, 0);
  const centre = axialToPixel(layout, { q: 0, r: 0 });
  const ring = [{ q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: -1, r: 1 }];

  it('counts the hex and its six neighbours in a circle of one and a half hexes', () => {
    expect(keys(circle(centre, 105), grid)).toEqual(['0,0', ...ring.map(axialKey)].sort());
  });

  it('leaves out neighbours whose centre lies on the circle', () => {
    expect(keys(circle(centre, 70), grid)).toEqual(['0,0']);
  });

  it('counts a hex a cone covers exactly half of', () => {
    // A 180° cone from the hex's centre cuts it along an axis of symmetry.
    const covered = keys(cone(centre, { x: centre.x + 300, y: centre.y }, 180), grid);
    expect(covered).toContain('0,0');
    expect(covered).not.toContain(axialKey(pixelToAxial(layout, { x: centre.x - 70, y: centre.y })));
  });

  it('leaves out a hex a cone covers less than half of', () => {
    const covered = keys(cone({ x: centre.x + 1, y: centre.y }, { x: centre.x + 300, y: centre.y }, 180), grid);
    expect(covered).not.toContain('0,0');
  });

  it('starts a cone on a hex corner', () => {
    // From the corner shared by three hexes, a 90° cone pointing away from one of them.
    const corner = type === 'hex-vertical' ? { x: centre.x, y: centre.y - 70 / Math.sqrt(3) } : { x: centre.x + 70 / Math.sqrt(3), y: centre.y };
    const away = { x: corner.x + (corner.x - centre.x) * 10, y: corner.y + (corner.y - centre.y) * 10 };
    const covered = keys(cone(corner, away, 90), grid);
    expect(covered).not.toContain('0,0');
    expect(covered.length).toBeGreaterThan(0);
  });
});

/** A seeded generator, so a failure names its case. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
}

/** Whether `point` lies in `area`, the rule the drawing shows. */
function inside(area: AreaShape, point: Point): boolean {
  if (area.kind === 'circle') return Math.hypot(point.x - area.center.x, point.y - area.center.y) <= area.radius;
  const radius = Math.hypot(area.toward.x - area.apex.x, area.toward.y - area.apex.y);
  if (Math.hypot(point.x - area.apex.x, point.y - area.apex.y) > radius) return false;
  const axis = Math.atan2(area.toward.y - area.apex.y, area.toward.x - area.apex.x);
  const bearing = Math.atan2(point.y - area.apex.y, point.x - area.apex.x);
  const off = Math.abs(Math.atan2(Math.sin(bearing - axis), Math.cos(bearing - axis)));
  return off <= area.angle * Math.PI / 360;
}

/** The share of every cell near `area` that it covers, counted on a fine lattice of sample points. */
function sampledShares(area: AreaShape, grid: GridGeometry, reach: number, origin: Point): Map<string, number> {
  const step = grid.size / 40;
  const layout = grid.type === 'square' ? null : createHexLayout(grid.type as HexGridType, grid.size, grid.offsetX ?? 0, grid.offsetY ?? 0);
  const totals = new Map<string, { all: number; in: number }>();
  for (let x = origin.x - reach; x <= origin.x + reach; x += step) {
    for (let y = origin.y - reach; y <= origin.y + reach; y += step) {
      const point = { x, y };
      const key = layout
        ? axialKey(pixelToAxial(layout, point))
        : `${Math.floor((x - (grid.offsetX ?? 0)) / grid.size)},${Math.floor((y - (grid.offsetY ?? 0)) / grid.size)}`;
      const total = totals.get(key) ?? { all: 0, in: 0 };
      total.all += 1;
      if (inside(area, point)) total.in += 1;
      totals.set(key, total);
    }
  }
  return new Map([...totals].map(([key, { all, in: hits }]) => [key, hits / all]));
}

describe('the covered cells against a count of sample points (seeded)', () => {
  it.each(['square', 'hex-vertical', 'hex-horizontal'] as const)('agrees on %s grids wherever the share is clear', (type) => {
    const random = seeded(type.length * 101);
    for (let trial = 0; trial < 12; trial++) {
      const grid: GridGeometry = { type, size: 30 + random() * 40, offsetX: random() * 50, offsetY: random() * 50 };
      const origin = { x: 200 + random() * 100, y: 200 + random() * 100 };
      const radius = grid.size * (0.5 + random() * 3);
      const direction = random() * 2 * Math.PI;
      const toward = { x: origin.x + radius * Math.cos(direction), y: origin.y + radius * Math.sin(direction) };
      const area = trial % 2 === 0 ? circle(origin, radius) : cone(origin, toward, [53.13, 90, 60, 200][trial % 4]!);
      const covered = new Set(keys(area, grid));
      // The lattice holds only cells well inside it, whose sampled share is to be trusted.
      const shares = sampledShares(area, grid, radius + 2 * grid.size, origin);
      for (const [key, share] of shares) {
        if (share > 0.55) expect(covered, `${type} trial ${trial} cell ${key} share ${share}`).toContain(key);
        if (share < 0.45) expect(covered, `${type} trial ${trial} cell ${key} share ${share}`).not.toContain(key);
      }
    }
  });
});
