import { MAX_SCENE_ID } from './moves.ts';
import { isRecord } from './shape.ts';
import { COLOUR_PATTERN, MAX_COORDINATE } from './tokens.ts';

/**
 * What players draw and write on the shared map with their own tools: a pen stroke or a stamped
 * icon, a text, and taking back what they made. The GM keeps each in the scene as Atlas's own
 * drawings and texts, marked with who made it, so everyone sees it in the `annotations` message
 * and a player may take back only their own.
 */

/** The most points (x, y pairs) of one stroke message: a longer stroke goes as several, each beginning where the last ended. */
export const MAX_STROKE_POINTS = 150;
/** The longest text a player places, in characters. */
export const MAX_PLAYER_TEXT = 500;
/** The most drawings and texts one player keeps in one scene; the GM refuses more. */
export const MAX_PLAYER_ANNOTATIONS = 400;
/** The most ids one erase message names. */
export const MAX_ERASE_IDS = 100;
/** A player's pen widths and text sizes, as the GM's tools offer them; an icon's footprint may be larger. */
export const PEN_WIDTH = { min: 1, max: 40 } as const;
export const ICON_WIDTH = { min: 8, max: 1_000 } as const;
export const TEXT_SIZE = { min: 10, max: 96 } as const;
/** An annotation's id: 96 random bits in hex, made by the player's page. */
export const ANNOTATION_ID_PATTERN = /^[0-9a-f]{24}$/;
const ICON_PATTERN = /^[a-z0-9-]{1,40}$/;

export interface PlayerStroke {
  readonly type: 'pen' | 'icon';
  /** World pixels, x and y in turn; an icon has its centre alone. */
  readonly points: readonly number[];
  readonly colour: string;
  readonly width: number;
  readonly icon?: string;
}

export interface PlayerTextDraft {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly fontSize: number;
  readonly colour: string;
  readonly bold: boolean;
}

export type PlayerAnnotationMessage =
  | { readonly t: 'draw'; readonly scene: string; readonly id: string; readonly drawing: PlayerStroke }
  | { readonly t: 'place-text'; readonly scene: string; readonly id: string; readonly text: PlayerTextDraft }
  | { readonly t: 'erase'; readonly scene: string; readonly ids: readonly string[] };

const ANNOTATION_TYPES: readonly string[] = ['draw', 'place-text', 'erase'];
export const isPlayerAnnotationType = (value: unknown): boolean => typeof value === 'string' && ANNOTATION_TYPES.includes(value);

const isIn = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const isPlace = (value: unknown): value is number => isIn(value, -MAX_COORDINATE, MAX_COORDINATE);
const isScene = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_SCENE_ID;
export const isAnnotationId = (value: unknown): value is string => typeof value === 'string' && ANNOTATION_ID_PATTERN.test(value);

function parseStroke(value: unknown): PlayerStroke | null {
  if (!isRecord(value) || typeof value.colour !== 'string' || !COLOUR_PATTERN.test(value.colour) || !Array.isArray(value.points)) return null;
  const points = value.points as unknown[];
  if (!points.every(isPlace)) return null;
  if (value.type === 'icon') {
    if (points.length !== 2 || !isIn(value.width, ICON_WIDTH.min, ICON_WIDTH.max) || typeof value.icon !== 'string' || !ICON_PATTERN.test(value.icon)) return null;
    return { type: 'icon', points: points, colour: value.colour, width: value.width, icon: value.icon };
  }
  if (value.type !== 'pen' || points.length < 2 || points.length % 2 !== 0 || points.length > MAX_STROKE_POINTS * 2 || !isIn(value.width, PEN_WIDTH.min, PEN_WIDTH.max)) return null;
  return { type: 'pen', points: points, colour: value.colour, width: value.width };
}

function parseTextDraft(value: unknown): PlayerTextDraft | null {
  if (!isRecord(value) || !isPlace(value.x) || !isPlace(value.y) || typeof value.text !== 'string' || typeof value.bold !== 'boolean') return null;
  const text = value.text.trim();
  if (text === '' || [...text].length > MAX_PLAYER_TEXT || !isIn(value.fontSize, TEXT_SIZE.min, TEXT_SIZE.max) || typeof value.colour !== 'string' || !COLOUR_PATTERN.test(value.colour)) return null;
  return { x: value.x, y: value.y, text, fontSize: value.fontSize, colour: value.colour, bold: value.bold };
}

/** A player's drawing, text or erase, or null for anything malformed. */
export function parsePlayerAnnotation(value: Record<string, unknown>): PlayerAnnotationMessage | null {
  if (!isScene(value.scene)) return null;
  if (value.t === 'erase') {
    const ids = value.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_ERASE_IDS || !ids.every(isAnnotationId)) return null;
    return { t: 'erase', scene: value.scene, ids: [...new Set(ids)] };
  }
  if (!isAnnotationId(value.id)) return null;
  if (value.t === 'draw') {
    const drawing = parseStroke(value.drawing);
    return drawing === null ? null : { t: 'draw', scene: value.scene, id: value.id, drawing };
  }
  if (value.t === 'place-text') {
    const text = parseTextDraft(value.text);
    return text === null ? null : { t: 'place-text', scene: value.scene, id: value.id, text };
  }
  return null;
}
