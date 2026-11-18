// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { examinedCellCount, type AreaShape } from '../../src/app/grid/areaCoverage';
import type { GridGeometry } from '../../src/app/grid/gridDistance';
import { MeasureInk, MeasureInkLayer } from '../../src/app/pixi/utils/measureInk';
import { drawMeasurement, MAX_EXAMINED_CELLS, type MeasureRecord } from '../../src/app/pixi/utils/measureDrawing';

/** One frame at 60 frames a second, in milliseconds. */
const FRAME_MS = 1000 / 60;

/** The largest circle, in steps of a tenth of a cell, whose highlight still looks at no more than `MAX_EXAMINED_CELLS`. */
function largestHighlightedCircle(grid: GridGeometry): MeasureRecord {
  const start = { x: grid.size / 2, y: grid.size / 2 };
  const circle = (radius: number): AreaShape => ({ kind: 'circle', center: start, radius });
  let radius = grid.size / 10;
  while (examinedCellCount(circle(radius + grid.size / 10), grid) <= MAX_EXAMINED_CELLS) radius += grid.size / 10;
  return { shape: 'circle', start, end: { x: start.x + radius, y: start.y } };
}

/**
 * The fastest of a few draws of a new measurement (a move of the pointer draws a new record, so no
 * draw reuses the cells of the last), after the code has warmed up as it has while someone measures.
 */
function fastestDraw(grid: GridGeometry, record: MeasureRecord): number {
  const ink = new MeasureInk(new MeasureInkLayer());
  const draw = (): void => drawMeasurement(ink, 0xff0000, { ...record }, 90, grid);
  for (let i = 0; i < 10; i++) draw();
  let fastest = Infinity;
  for (let i = 0; i < 5; i++) {
    const begun = performance.now();
    ink.begin(1);
    draw();
    fastest = Math.min(fastest, performance.now() - begun);
  }
  return fastest;
}

describe('the most cells a measurement highlights', () => {
  for (const type of ['square', 'hex-vertical', 'hex-horizontal'] as const) {
    it(`are worked out and drawn within a frame at 60 fps on a ${type} grid`, () => {
      const grid: GridGeometry = { type, size: 70, offsetX: 0, offsetY: 0 };
      const record = largestHighlightedCircle(grid);
      const time = fastestDraw(grid, record);
      console.log(`${type}: a circle of ${Math.round(Math.hypot(record.end.x - record.start.x, record.end.y - record.start.y) / grid.size)} cells drawn with its cells in ${time.toFixed(2)} ms`);
      expect(time).toBeLessThan(FRAME_MS);
    });
  }
});
