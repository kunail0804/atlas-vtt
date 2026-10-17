import { MAX_PLAYER_ANNOTATIONS, PLAYER_ID_PATTERN, type PlayerAnnotationMessage } from '../protocol/index.ts';
import type { DrawingStroke, TextElement } from '../../types';
import type { ViewState } from '../../types/viewState';
import { MoveRate, type MapSize } from './moveCheck.ts';

/** A player's drawings and texts keep these prefixes, as the GM's own (`drawing_`, `text_`): Atlas's tools select texts by theirs. */
const DRAWING_KEY = 'drawing_player_';
const TEXT_KEY = 'text_player_';
const PLAYER_KEY = /_player_([0-9a-f]{24})$/;

/** How far past the map's edges a player may draw, as a share of its sides. */
const MARGIN = 0.1;
/** A player's writes: a stroke goes as several messages, so the burst is generous. */
const ANNOTATION_BURST = 60;
const ANNOTATIONS_PER_SECOND = 20;

/** A text placed by a player looks as one the GM's text tool places (`TextTool`'s defaults). */
const TEXT_LOOK = { fontFamily: 'Arial', backgroundColor: '#000000', padding: 8, borderRadius: 4, opacity: 0.7, align: 'center' as const, italic: false, rotation: 0, scale: 1 };

/** The id players know a drawing or text by, and who made it, where a player did; nothing for the GM's own. */
export function authorOf(record: { readonly id: string; readonly author?: string | undefined }): { id?: string; by?: string } {
  const match = PLAYER_KEY.exec(record.id);
  return match?.[1] !== undefined && typeof record.author === 'string' && PLAYER_ID_PATTERN.test(record.author) ? { id: match[1], by: record.author } : {};
}

export type AnnotationState = Pick<ViewState, 'objects' | 'mapLoaded' | 'isMapLoading'>;

export interface AnnotationStore {
  getState(): AnnotationState;
  /** A write through Atlas's own middleware: one undo step of the GM's. */
  setState(recipe: (draft: AnnotationState) => void): void;
}

export interface PlayerAnnotationPorts {
  /** The id of the scene players were sent, or null while none is shared. */
  scene(): string | null;
  /** The shared map's size; null while it is unknown, which takes nothing. */
  map(): MapSize | null;
  now(): number;
}

/**
 * Drawings and texts players make with their own tools on the shared scene, kept in the scene as
 * Atlas's own (so the GM sees them, saves them with the map and may erase or undo them) and marked
 * with who made them: a player takes back only their own. Each player keeps at most
 * `MAX_PLAYER_ANNOTATIONS` in a scene, on the map or close to it, at a rate.
 */
export class PlayerAnnotations {
  private readonly store: AnnotationStore;
  private readonly ports: PlayerAnnotationPorts;
  private readonly rate = new MoveRate(ANNOTATION_BURST, ANNOTATIONS_PER_SECOND);

  constructor(store: AnnotationStore, ports: PlayerAnnotationPorts) {
    this.store = store;
    this.ports = ports;
  }

  receive(from: string, message: PlayerAnnotationMessage): void {
    const state = this.store.getState();
    const map = this.ports.map();
    if (message.scene !== this.ports.scene() || map === null || !state.mapLoaded || state.isMapLoading) return;
    if (!this.rate.take(from, this.ports.now())) return;
    if (message.t === 'erase') return this.erase(from, message.ids);
    if (this.count(state, from) >= MAX_PLAYER_ANNOTATIONS) return;
    const onMap = (x: number, y: number): boolean => x >= -map.width * MARGIN && x <= map.width * (1 + MARGIN) && y >= -map.height * MARGIN && y <= map.height * (1 + MARGIN);
    if (message.t === 'draw') {
      const { drawing } = message;
      const points: { x: number; y: number }[] = [];
      for (let index = 0; index + 1 < drawing.points.length; index += 2) points.push({ x: drawing.points[index]!, y: drawing.points[index + 1]! });
      if (!points.every((point) => onMap(point.x, point.y))) return;
      const id = `${DRAWING_KEY}${message.id}`;
      if (state.objects.drawings[id] !== undefined) return;
      const stroke: DrawingStroke = {
        id, kind: 'drawing', timestamp: Date.now(), type: drawing.type, points, color: drawing.colour, width: drawing.width, opacity: 1,
        ...(drawing.icon !== undefined && { icon: drawing.icon }), author: from,
      };
      return this.store.setState((draft) => {
        draft.objects.drawings[id] = stroke;
      });
    }
    const { text } = message;
    if (!onMap(text.x, text.y)) return;
    const id = `${TEXT_KEY}${message.id}`;
    if (state.objects.texts[id] !== undefined) return;
    const element: TextElement = { id, kind: 'text', x: text.x, y: text.y, text: text.text, fontSize: text.fontSize, color: text.colour, bold: text.bold, ...TEXT_LOOK, author: from };
    this.store.setState((draft) => {
      draft.objects.texts[id] = element;
    });
  }

  /** Takes back what the player made among `ids`; ids of others' are left alone. */
  private erase(from: string, ids: readonly string[]): void {
    const { drawings, texts } = this.store.getState().objects;
    const gone = ids.flatMap((id) => [`${DRAWING_KEY}${id}`, `${TEXT_KEY}${id}`]).filter((key) => drawings[key]?.author === from || texts[key]?.author === from);
    if (gone.length === 0) return;
    this.store.setState((draft) => {
      for (const key of gone) {
        delete draft.objects.drawings[key];
        delete draft.objects.texts[key];
      }
    });
  }

  private count(state: AnnotationState, from: string): number {
    let held = 0;
    for (const drawing of Object.values(state.objects.drawings)) if (drawing.author === from) held += 1;
    for (const text of Object.values(state.objects.texts)) if (text.author === from) held += 1;
    return held;
  }
}
