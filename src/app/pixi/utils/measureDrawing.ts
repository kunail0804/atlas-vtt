/**
 * Drawing shared by the measure tool, the token drag ruler and other people's measurements: the
 * accent path, its point markers and the measured areas, in the ink of the selection highlight
 * (`MeasureInk`); the distance goes on a `MeasureLabel`.
 */

import { cellsCoveredBy, type AreaShape } from '../../grid/areaCoverage';
import type { GridGeometry } from '../../grid/gridDistance';
import type { Point } from '../../grid/hexGeometry';
import { MEASURE_DOT, type LabelTarget } from './measureLabelLayout';
import type { InkTrace, MeasureInk } from './measureInk';

/** The shapes the measure tool draws; a sphere is drawn as a circle. */
export type MeasureShape = 'line' | 'cone' | 'circle' | 'sphere';

/** A measurement as data: its shape, where it starts and where it was dragged to, in world pixels. */
export interface MeasureRecord {
  readonly shape: MeasureShape;
  readonly start: Point;
  readonly end: Point;
}

/** A polyline through world `points`: one stroke, so its joints are as clean as its segments. */
export function drawMeasurePath(ink: MeasureInk, color: number, points: readonly Point[]): void {
  const screen = points.map((point) => ink.screen(point));
  const [first, ...rest] = screen;
  if (!first || rest.length === 0) return;
  ink.stroke((g) => {
    g.moveTo(first.x, first.y);
    for (const point of rest) g.lineTo(point.x, point.y);
  }, color);
}

/** The path ending `gap` before its last point; a last segment shorter than that is left out. */
export function shortenPathEnd(points: readonly Point[], gap: number): Point[] {
  const end = points[points.length - 1];
  const before = points[points.length - 2];
  if (!end || !before) return [...points];
  const length = Math.hypot(end.x - before.x, end.y - before.y);
  if (length <= gap) return points.slice(0, -1);
  const t = (length - gap) / length;
  return [...points.slice(0, -1), { x: before.x + (end.x - before.x) * t, y: before.y + (end.y - before.y) * t }];
}

/** A dot where a measurement turns or ends: a node of its line; where it starts (`origin`), a ring. */
export function drawMeasurePoint(ink: MeasureInk, color: number, point: Point, origin = false): void {
  ink.dot(point, origin ? MEASURE_DOT + 1 : MEASURE_DOT, color, origin);
}

/** A circular area around `center` of `radius` world units: an even wash inside one outline. */
export function drawMeasureCircle(ink: MeasureInk, color: number, center: Point, radius: number): void {
  const { x, y } = ink.screen(center);
  const r = ink.screen({ x: radius, y: 0 }).x;
  // Canvas 2D (the renderer without WebGL) throws on a negative arc radius, which stops the map from rendering.
  if (!(r > 0)) return;
  const trace: InkTrace = (g) => { g.circle(x, y, r); };
  ink.fill(trace, color);
  ink.stroke(trace, color);
}

/** The cone from `start` towards `end` in screen pixels: as long as the distance between them and `coneAngle` degrees wide. */
function coneTrace(start: Point, end: Point, coneAngle: number): InkTrace | null {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (!(distance > 0)) return null;
  const halfAngle = coneAngle * Math.PI / 360;
  const baseAngle = Math.atan2(end.y - start.y, end.x - start.x);
  const leftAngle = baseAngle - halfAngle;
  const rightAngle = baseAngle + halfAngle;
  // The arc runs on from the apex itself: a line to its first point as well would leave a segment of
  // no length there, and the joint around it would lose its rounding.
  return (g) => {
    g.moveTo(start.x, start.y);
    g.arc(start.x, start.y, distance, leftAngle, rightAngle, false);
    g.closePath();
  };
}

/** A cone from `start` towards `end` (world points), `coneAngle` degrees wide: one outline around an even wash. */
export function drawMeasureCone(ink: MeasureInk, color: number, start: Point, end: Point, coneAngle: number): void {
  const trace = coneTrace(ink.screen(start), ink.screen(end), coneAngle);
  if (!trace) return;
  ink.fill(trace, color);
  ink.stroke(trace, color);
}

/** The area a measurement covers: a circle or sphere around its start, a cone `coneAngle` degrees wide; a line covers none. */
export function measureArea({ shape, start, end }: MeasureRecord, coneAngle: number): AreaShape | null {
  switch (shape) {
    case 'line':
      return null;
    case 'circle':
    case 'sphere':
      return { kind: 'circle', center: start, radius: Math.hypot(end.x - start.x, end.y - start.y) };
    case 'cone':
      return { kind: 'cone', apex: start, toward: end, angle: coneAngle };
  }
}

/** The cells last worked out for a measurement, so a redraw at another zoom does not work them out again. */
interface CoveredOutlines {
  readonly grid: GridGeometry;
  readonly coneAngle: number;
  readonly outlines: readonly (readonly Point[])[];
}

const coveredByRecord = new WeakMap<MeasureRecord, CoveredOutlines>();

const sameGrid = (a: GridGeometry, b: GridGeometry): boolean =>
  a.type === b.type && a.size === b.size && (a.offsetX ?? 0) === (b.offsetX ?? 0) && (a.offsetY ?? 0) === (b.offsetY ?? 0);

/** The outlines of the cells `measurement` covers on `grid` (`cellsCoveredBy`). */
export function coveredCellOutlines(measurement: MeasureRecord, coneAngle: number, grid: GridGeometry): readonly (readonly Point[])[] {
  const known = coveredByRecord.get(measurement);
  if (known && known.coneAngle === coneAngle && sameGrid(known.grid, grid)) return known.outlines;
  const area = measureArea(measurement, coneAngle);
  const outlines = area ? cellsCoveredBy(area, grid).map((cell) => cell.corners) : [];
  coveredByRecord.set(measurement, { grid: { ...grid }, coneAngle, outlines });
  return outlines;
}

/**
 * Draws `measurement` in `color` onto `ink` (begun at the zoom it is shown at): a line with a dot at
 * its end, a circle around its start, or a cone `coneAngle` degrees wide, over the cells of `grid` it
 * covers (none without a grid); then the dot at its start.
 */
export function drawMeasurement(ink: MeasureInk, color: number, measurement: MeasureRecord, coneAngle: number, grid: GridGeometry | null): void {
  const { shape, start, end } = measurement;
  if (grid) ink.cells(coveredCellOutlines(measurement, coneAngle, grid), color);
  switch (shape) {
    case 'line':
      drawMeasurePath(ink, color, [start, end]);
      drawMeasurePoint(ink, color, end);
      break;
    case 'circle':
    case 'sphere':
      drawMeasureCircle(ink, color, start, Math.hypot(end.x - start.x, end.y - start.y));
      break;
    case 'cone':
      drawMeasureCone(ink, color, start, end, coneAngle);
      break;
  }
  drawMeasurePoint(ink, color, start, true);
}

/** Where a measurement's distance goes: beside a line, above a circle's centre, over the middle of a cone's axis. */
export function measureLabelTarget({ shape, start, end }: MeasureRecord): LabelTarget {
  switch (shape) {
    case 'line':
      return { beside: [start, end] };
    case 'circle':
    case 'sphere':
      return { beside: [start] };
    case 'cone':
      return { over: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 } };
  }
}
