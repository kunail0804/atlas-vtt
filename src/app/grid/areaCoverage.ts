/**
 * Which cells of a grid an area of effect covers. The rule is the Dungeon Master's Guide's: a cell
 * is covered when the shape covers at least half of its surface. It holds alike for square and hex
 * cells, and for circles (spheres are drawn as circles) and cones. The share is the exact area of the
 * cell's polygon that lies in the shape, not a count of sample points, so a cell cut exactly in half
 * is covered wherever on the map it lies.
 */

import type { GridGeometry } from './gridDistance';
import { axialToPixel, createHexLayout, hexCircumradius, hexVertices, isHexGridType, pixelToFractionalAxial, type HexLayout, type Point } from './hexGeometry';
import { axialKey } from './hexLattice';

/** An area of effect in world pixels: a circle around its centre, or a cone from its apex towards a point as far as that point. */
export type AreaShape =
  | { readonly kind: 'circle'; readonly center: Point; readonly radius: number }
  | { readonly kind: 'cone'; readonly apex: Point; readonly toward: Point; readonly angle: number };

/** A covered cell: its key on the grid's lattice (`col,row` for squares, `axialKey` for hexes) and its outline in world pixels. */
export interface CoveredCell {
  readonly key: string;
  readonly corners: readonly Point[];
}

/** The share of a cell's surface the shape must cover. */
export const COVERED_SHARE = 0.5;

/** Rounding the exact area may leave short of an exact half, as a share of the cell. */
const SHARE_TOLERANCE = 1e-9;

/** The cells `area` covers at least half of, on `grid`. */
export function cellsCoveredBy(area: AreaShape, grid: GridGeometry): CoveredCell[] {
  const disc = discOf(area);
  if (!(disc.radius > 0) || !(grid.size > 0)) return [];
  const wedges = area.kind === 'cone' ? coneWedges(area) : null;
  if (wedges !== null && wedges.length === 0) return [];
  const covered: CoveredCell[] = [];
  for (const cell of candidateCells(disc, grid)) {
    const cellArea = Math.abs(signedArea(cell.corners));
    if (coveredArea(cell.corners, disc, wedges) >= (COVERED_SHARE - SHARE_TOLERANCE) * cellArea) covered.push(cell);
  }
  return covered;
}

interface Disc {
  readonly center: Point;
  readonly radius: number;
}

function discOf(area: AreaShape): Disc {
  if (area.kind === 'circle') return { center: area.center, radius: area.radius };
  return { center: area.apex, radius: Math.hypot(area.toward.x - area.apex.x, area.toward.y - area.apex.y) };
}

/** A wedge from the cone's apex no wider than a half turn, between two directions: a convex region. */
interface Wedge {
  readonly from: Point;
  readonly to: Point;
}

/** The cone's angle as wedges of at most a half turn each, side by side, so each is convex. */
function coneWedges(cone: Extract<AreaShape, { kind: 'cone' }>): Wedge[] {
  const angle = Math.min(cone.angle, 360) * Math.PI / 180;
  if (!(angle > 0)) return [];
  const axis = Math.atan2(cone.toward.y - cone.apex.y, cone.toward.x - cone.apex.x);
  const pieces = Math.ceil(angle / Math.PI);
  const wedges: Wedge[] = [];
  for (let i = 0; i < pieces; i++) {
    const start = axis - angle / 2 + (angle * i) / pieces;
    const end = axis - angle / 2 + (angle * (i + 1)) / pieces;
    wedges.push({ from: { x: Math.cos(start), y: Math.sin(start) }, to: { x: Math.cos(end), y: Math.sin(end) } });
  }
  return wedges;
}

/** The area of the convex polygon `corners` inside the disc, and inside one of the wedges when there are any. */
function coveredArea(corners: readonly Point[], disc: Disc, wedges: readonly Wedge[] | null): number {
  if (wedges === null) return Math.abs(polygonInDisc(corners, disc));
  let total = 0;
  for (const { from, to } of wedges) {
    // Inside the wedge: on the left of its first edge and on the right of its second, seen from the apex.
    const inFirst = clipToHalfPlane(corners, (p) => cross(from, sub(p, disc.center)));
    const inWedge = clipToHalfPlane(inFirst, (p) => cross(sub(p, disc.center), to));
    total += Math.abs(polygonInDisc(inWedge, disc));
  }
  return total;
}

/** The part of a convex polygon where `side` is not negative (Sutherland–Hodgman against one line). */
function clipToHalfPlane(corners: readonly Point[], side: (point: Point) => number): Point[] {
  const kept: Point[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    const sa = side(a);
    const sb = side(b);
    if (sa >= 0) kept.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      kept.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return kept;
}

/** The signed area of a polygon intersected with a disc: the sum over its edges of each triangle from the centre intersected with the disc. */
function polygonInDisc(corners: readonly Point[], disc: Disc): number {
  let total = 0;
  for (let i = 0; i < corners.length; i++) {
    total += triangleInDisc(sub(corners[i]!, disc.center), sub(corners[(i + 1) % corners.length]!, disc.center), disc.radius);
  }
  return total;
}

/** The signed area of the triangle (centre, a, b) inside a disc of `radius` around the centre (the origin here). */
function triangleInDisc(a: Point, b: Point, radius: number): number {
  const r2 = radius * radius;
  const aInside = dot(a, a) <= r2;
  const bInside = dot(b, b) <= r2;
  if (aInside && bInside) return cross(a, b) / 2;
  // Where the segment from a to b meets the circle: a + t (b - a) with t the roots of a quadratic.
  const d = sub(b, a);
  const qa = dot(d, d);
  const qb = 2 * dot(a, d);
  const qc = dot(a, a) - r2;
  const discriminant = qb * qb - 4 * qa * qc;
  const sector = (u: Point, v: Point): number => (r2 / 2) * Math.atan2(cross(u, v), dot(u, v));
  if (qa === 0 || discriminant <= 0) return sector(a, b);
  const root = Math.sqrt(discriminant);
  const t1 = (-qb - root) / (2 * qa);
  const t2 = (-qb + root) / (2 * qa);
  const at = (t: number): Point => ({ x: a.x + d.x * t, y: a.y + d.y * t });
  if (aInside) {
    const exit = at(t2);
    return cross(a, exit) / 2 + sector(exit, b);
  }
  if (bInside) {
    const entry = at(t1);
    return sector(a, entry) + cross(entry, b) / 2;
  }
  if (t1 >= 0 && t2 <= 1) {
    const entry = at(t1);
    const exit = at(t2);
    return sector(a, entry) + cross(entry, exit) / 2 + sector(exit, b);
  }
  return sector(a, b);
}

/** Every cell that may meet the disc: those whose centre lies within the disc's radius plus the cell's own. */
function candidateCells(disc: Disc, grid: GridGeometry): CoveredCell[] {
  if (isHexGridType(grid.type)) return hexCandidates(disc, createHexLayout(grid.type, grid.size, grid.offsetX ?? 0, grid.offsetY ?? 0));
  return squareCandidates(disc, grid.size, grid.offsetX ?? 0, grid.offsetY ?? 0);
}

function squareCandidates({ center, radius }: Disc, size: number, offsetX: number, offsetY: number): CoveredCell[] {
  const cells: CoveredCell[] = [];
  const firstCol = Math.floor((center.x - radius - offsetX) / size);
  const lastCol = Math.floor((center.x + radius - offsetX) / size);
  const firstRow = Math.floor((center.y - radius - offsetY) / size);
  const lastRow = Math.floor((center.y + radius - offsetY) / size);
  for (let row = firstRow; row <= lastRow; row++) {
    for (let col = firstCol; col <= lastCol; col++) {
      const x = offsetX + col * size;
      const y = offsetY + row * size;
      cells.push({ key: `${col},${row}`, corners: [{ x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size }] });
    }
  }
  return cells;
}

function hexCandidates({ center, radius }: Disc, layout: HexLayout): CoveredCell[] {
  // The disc's bounding box maps to a parallelogram of axial coordinates, whose extremes lie at its corners.
  const corners = [
    { x: center.x - radius, y: center.y - radius }, { x: center.x + radius, y: center.y - radius },
    { x: center.x - radius, y: center.y + radius }, { x: center.x + radius, y: center.y + radius },
  ].map((point) => pixelToFractionalAxial(layout, point));
  const qs = corners.map((c) => c.q);
  const rs = corners.map((c) => c.r);
  const reach = radius + hexCircumradius(layout.size);
  const cells: CoveredCell[] = [];
  for (let q = Math.floor(Math.min(...qs)) - 1; q <= Math.ceil(Math.max(...qs)) + 1; q++) {
    for (let r = Math.floor(Math.min(...rs)) - 1; r <= Math.ceil(Math.max(...rs)) + 1; r++) {
      const middle = axialToPixel(layout, { q, r });
      if (Math.hypot(middle.x - center.x, middle.y - center.y) > reach) continue;
      cells.push({ key: axialKey({ q, r }), corners: hexVertices(layout, middle) });
    }
  }
  return cells;
}

function signedArea(corners: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i < corners.length; i++) total += cross(corners[i]!, corners[(i + 1) % corners.length]!);
  return total / 2;
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: Point, b: Point): number {
  return a.x * b.y - a.y * b.x;
}
