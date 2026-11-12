// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, type FederatedPointerEvent } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { MeasureRenderer, type MeasureStore, type MeasureToolEvents } from '../../src/app/pixi/MeasureRenderer';
import { MeasureInk } from '../../src/app/pixi/utils/measureInk';
import { MeasureLabel } from '../../src/app/pixi/utils/measureLabel';
import { RemoteMeasures } from '../../src/app/online/marks/RemoteMeasures';
import { resolveMeasurementSettings } from '../../src/app/grid/measurementFormat';
import { squareCellCentre } from '../../src/app/grid/squareLattice';
import type { Point } from '../../src/app/grid/hexGeometry';

const GRID = { type: 'square' as const, size: 10, offsetX: 0, offsetY: 0 };

/** A view with the measure tool picked, its viewport at zoom 1 with world and screen alike. */
function measuring(tool: 'measure' | 'measure-circle' | 'measure-cone'): { renderer: MeasureRenderer; viewport: Container } {
  const viewport = Object.assign(new Container(), { toWorld: (point: Point): Point => ({ x: point.x, y: point.y }) });
  const state = { activeTool: tool, grid: { snapToGrid: false } };
  const listeners: Array<(next: typeof state) => void> = [];
  const store = { getState: () => state, subscribe: (listener: (next: typeof state) => void) => { listeners.push(listener); return () => undefined; } } as unknown as MeasureStore;
  const events: MeasureToolEvents = { on: () => undefined, off: () => undefined };
  const grid = { getOptions: () => GRID, snapToCellCenter: (x: number, y: number): Point => squareCellCentre(GRID, { x, y }) };
  const renderer = new MeasureRenderer(viewport as unknown as Viewport, events, store, grid);
  renderer.measurementSettingsProvider = () => ({ ...defaultSettings, coneAngle: 90 });
  // The renderer takes its shape from the tool when the tool is picked, which is a change of the store.
  for (const listener of listeners) listener(state);
  return { renderer, viewport };
}

const defaultSettings = { mode: 'grid', unitType: 'ft', unitDistance: 5, ruleDistance: 5, diagonalRule: 'chebyshev', rangeBands: [] } as never;

const pointer = (type: string, x: number, y: number): FederatedPointerEvent =>
  ({ type, button: 0, global: { x, y }, stopPropagation: () => undefined }) as unknown as FederatedPointerEvent;

/** The centres of the cells the last drawing highlighted. */
function lastCells(spy: ReturnType<typeof vi.spyOn>): string[] {
  const outlines = spy.mock.lastCall?.[0] as readonly (readonly Point[])[] | undefined;
  return (outlines ?? []).map((corners) => {
    const x = corners.reduce((sum, corner) => sum + corner.x, 0) / corners.length;
    const y = corners.reduce((sum, corner) => sum + corner.y, 0) / corners.length;
    return `${x},${y}`;
  }).sort();
}

// The distance label lays text out on a canvas, which jsdom has none of; the cells are what these tests read.
beforeEach(() => { vi.spyOn(MeasureLabel.prototype, 'show').mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());

describe('the cells a measurement highlights', () => {
  it('follow a circle as it grows and as its next one is drawn elsewhere', () => {
    const cells = vi.spyOn(MeasureInk.prototype, 'cells');
    const { renderer, viewport } = measuring('measure-circle');
    viewport.emit('pointerdown', pointer('pointerdown', 0, 0));
    viewport.emit('pointermove', pointer('pointermove', 10, 0));
    expect(lastCells(cells)).toEqual(['-5,-5', '-5,5', '5,-5', '5,5']);

    viewport.emit('pointermove', pointer('pointermove', 1, 0));
    expect(lastCells(cells)).toEqual([]);

    viewport.emit('pointerup', pointer('pointerup', 1, 0));
    viewport.emit('pointerdown', pointer('pointerdown', 100, 100));
    viewport.emit('pointermove', pointer('pointermove', 110, 100));
    expect(lastCells(cells)).toEqual(['105,105', '105,95', '95,105', '95,95']);
    renderer.destroy();
  });

  it('follow a cone as it turns', () => {
    const cells = vi.spyOn(MeasureInk.prototype, 'cells');
    const { renderer, viewport } = measuring('measure-cone');
    viewport.emit('pointerdown', pointer('pointerdown', 0, 5));
    viewport.emit('pointermove', pointer('pointermove', 20, 5));
    const east = lastCells(cells);
    expect(east).toContain('5,5');
    expect(east).not.toContain('-5,5');

    viewport.emit('pointermove', pointer('pointermove', -20, 5));
    const west = lastCells(cells);
    expect(west).toContain('-5,5');
    expect(west).not.toContain('5,5');
    renderer.destroy();
  });

  it('are none for a line', () => {
    const cells = vi.spyOn(MeasureInk.prototype, 'cells');
    const { renderer, viewport } = measuring('measure');
    viewport.emit('pointerdown', pointer('pointerdown', 0, 0));
    viewport.emit('pointermove', pointer('pointermove', 40, 0));
    expect(lastCells(cells)).toEqual([]);
    renderer.destroy();
  });
});

describe('the cells another person\'s measurement highlights (the player page, and the GM\'s view of players\' measurements)', () => {
  it('follow a kept circle that moves', () => {
    const cells = vi.spyOn(MeasureInk.prototype, 'cells');
    const measures = new RemoteMeasures(() => 1, () => ({ grid: GRID, measurement: resolveMeasurementSettings(undefined, null) }), 50);
    measures.update([{ who: 'ana', color: '#ff0000', live: null, kept: [{ shape: 'circle', a: [0, 0], b: [10, 0] }] }], 0);
    expect(lastCells(cells)).toEqual(['-5,-5', '-5,5', '5,-5', '5,5']);

    measures.update([{ who: 'ana', color: '#ff0000', live: null, kept: [{ shape: 'circle', a: [100, 100], b: [110, 100] }] }], 1);
    expect(lastCells(cells)).toEqual(['105,105', '105,95', '95,105', '95,95']);
    measures.destroy();
  });
});
