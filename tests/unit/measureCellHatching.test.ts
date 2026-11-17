// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Graphics, Texture, type FillInstruction } from 'pixi.js';
import type { GridGeometry } from '../../src/app/grid/gridDistance';
import { drawMeasurement, type MeasureRecord } from '../../src/app/pixi/utils/measureDrawing';
import { cellHatching, MeasureInk, MeasureInkLayer } from '../../src/app/pixi/utils/measureInk';

const GRID: GridGeometry = { type: 'square', size: 70, offsetX: 0, offsetY: 0 };
const COLOR = 0x3b82f6;

/** The fills of a measurement's area (`measure-area`), in the order they were drawn. */
function areaFills(record: MeasureRecord): FillInstruction[] {
  const layer = new MeasureInkLayer();
  const ink = new MeasureInk(layer);
  ink.begin(1);
  drawMeasurement(ink, COLOR, record, 90, GRID);
  const area = layer.areas.children[0] as Graphics;
  return area.context.instructions.filter((instruction): instruction is FillInstruction => instruction.action === 'fill');
}

describe('the cells a measured area covers', () => {
  const shapes: Record<string, MeasureRecord> = {
    circle: { shape: 'circle', start: { x: 175, y: 175 }, end: { x: 315, y: 175 } },
    cone: { shape: 'cone', start: { x: 35, y: 175 }, end: { x: 315, y: 175 } },
  };
  for (const [name, record] of Object.entries(shapes)) {
    it(`are hatched, not filled like the ${name}'s outline and wash`, () => {
      const [cells, wash] = areaFills(record);
      // The outline and the wash are the measurement's colour, plain; the cells are its stripes.
      expect(wash.data.style.texture).toBe(Texture.WHITE);
      expect(cells.data.style.texture).toBe(cellHatching());
      expect(cells.data.style.texture).not.toBe(wash.data.style.texture);
      // In the measurement's colour, which a pattern fill would have turned white.
      expect(cells.data.style.color).toBe(COLOR);
    });
  }

  it('are striped: the tile holds both opaque stripes and clear gaps', () => {
    const texels = cellHatching().source.resource as Uint8Array;
    const alphas = new Set(Array.from({ length: texels.length / 4 }, (_, i) => texels[i * 4 + 3]));
    expect([...alphas].sort()).toEqual([0, 255]);
  });
});
