import { Graphics, type Container } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { MAX_ERASE_IDS, MAX_PLAYER_TEXT, MAX_STROKE_POINTS, type PlayerAnnotationMessage } from '../../../src/app/online/protocol/annotate.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { SharedAnnotations, SharedDrawing, SharedText } from '../../../src/app/online/protocol/mapLayers.ts';
import { splitStrokeByBrush } from '../../../src/app/pixi/drawingEraseUtils.ts';
import { drawStroke } from '../../../src/app/pixi/drawingLayer.ts';
import { FogCursorPreview } from '../../../src/app/pixi/fog/FogCursorPreview.ts';
import { MAP_ICON_SIZE } from '../../../src/app/pixi/mapIcons.ts';
import type { AnnotationsView } from './annotations.ts';
import { randomId } from './bookDom.ts';
import { TEXT } from './text.ts';
import { iconWidth, type PlayerTool, type ToolSettingsStore } from './toolSettings.ts';

/** How often what the eraser did goes to the GM while it sweeps. */
const ERASE_FLUSH_MS = 80;
/** How long the page shows its own copy at most before it takes the GM's as it is (a write the GM refused). */
const SETTLE_MS = 3_000;
/** Extra world-space slack when the eraser covers an icon, as the GM's eraser has (`ERASER_SLACK`). */
const ERASER_SLACK = 6;
/** A text placed by a player looks as the GM's text tool places it (`TextTool`'s defaults); the GM keeps the same. */
const TEXT_LOOK = { fontFamily: 'Arial', background: '#000000', padding: 8, radius: 4, opacity: 0.7, align: 'center', italic: false, rotation: 0, scale: 1 } as const;

type Point = { x: number; y: number };
const rounded = (value: number): number => Math.round(value * 10) / 10;
const pairs = (points: readonly number[]): Point[] => {
  const result: Point[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) result.push({ x: points[index]!, y: points[index + 1]! });
  return result;
};

export interface DrawToolsPorts {
  readonly send: (message: PlayerMessage) => void;
  readonly scene: () => string | null;
  readonly self: () => string | null;
  readonly settings: ToolSettingsStore;
  /** Asks for a text where the player clicked, at that place on screen; null when they cancel. */
  readonly askText: (screen: Point) => Promise<string | null>;
}

/**
 * The player's pen, icon stamp, drawing eraser and text tool, as the GM's (`DrawingRenderer`,
 * `TextTool`): what they make goes to the GM, who keeps it in the scene and sends it to all. The page
 * shows its own copy at once and takes the GM's back once that holds what was sent. The eraser
 * rubs out only the player's own ink, and only the part under it, as the GM's does.
 */
export class DrawTools {
  private readonly viewport: Viewport;
  private readonly annotations: AnnotationsView;
  private readonly ports: DrawToolsPorts;
  private readonly preview = new Graphics();
  private readonly ring: FogCursorPreview;
  private tool: PlayerTool = 'move';
  private stroke: Point[] | null = null;
  private erasing = false;
  /** The player's own drawings and texts as this page holds them, while some write is not yet back from the GM. */
  private working: { drawings: SharedDrawing[]; texts: SharedText[] } | null = null;
  private readonly expectPresent = new Set<string>();
  private readonly expectAbsent = new Set<string>();
  private readonly queued = new Map<string, PlayerAnnotationMessage>();
  private readonly erased = new Set<string>();
  private flushTimer: number | undefined;
  private settleTimer: number | undefined;

  constructor(viewport: Viewport, layer: Container, annotations: AnnotationsView, ports: DrawToolsPorts) {
    this.viewport = viewport;
    this.annotations = annotations;
    this.ports = ports;
    this.preview.eventMode = 'none';
    layer.addChild(this.preview);
    this.ring = new FogCursorPreview(viewport);
    layer.addChild(this.ring.getDisplayObject());
    const syncRing = (): void => this.ring.setBrushRadius(ports.settings.get().draw.eraserWidth / 2);
    syncRing();
    ports.settings.subscribe(syncRing);
    viewport.on('pointerdown', (event) => this.down(event.button, event.global));
    viewport.on('globalpointermove', (event) => this.move(event.global));
    window.addEventListener('pointerup', () => this.up());
    annotations.onShown((shown) => this.heard(shown));
  }

  setTool(tool: PlayerTool): void {
    this.up();
    this.tool = tool;
    if (tool === 'draw-eraser') this.ring.show(true);
    else this.ring.hide();
  }

  /** Takes back every drawing and text the player made in the scene. */
  deleteMine(): void {
    const working = this.begin();
    if (working === null) return;
    for (const drawing of [...working.drawings]) this.remove(drawing.id);
    for (const text of [...working.texts]) this.remove(text.id);
    this.flush();
  }

  /** A new scene: nothing of the old one is kept or sent. */
  clear(): void {
    this.stroke = null;
    this.preview.clear();
    this.queued.clear();
    this.erased.clear();
    this.settle();
  }

  private world(global: Point): Point {
    const point = this.viewport.toWorld(global);
    return { x: point.x, y: point.y };
  }

  private down(button: number, global: Point): void {
    if (button !== 0 || this.ports.scene() === null) return;
    const at = this.world(global);
    const { draw, text } = this.ports.settings.get();
    if (this.tool === 'draw-pen') {
      this.stroke = [at];
      drawStroke(this.preview, this.stroke, draw.color, draw.width, 1);
    } else if (this.tool === 'draw-icon') {
      if (this.begin() === null) return;
      this.addDrawing({ type: 'icon', points: [rounded(at.x), rounded(at.y)], colour: draw.color, width: iconWidth(MAP_ICON_SIZE), opacity: 1, icon: draw.icon });
      this.flush();
    } else if (this.tool === 'draw-eraser') {
      this.erasing = true;
      this.eraseAt(at);
    } else if (this.tool === 'text') {
      void this.ports.askText({ x: global.x, y: global.y }).then((written) => {
        const shown = written?.trim().slice(0, MAX_PLAYER_TEXT) ?? '';
        if (shown === '' || this.begin() === null) return;
        const by = this.ports.self() ?? '';
        const id = randomId();
        const placed: SharedText = { x: rounded(at.x), y: rounded(at.y), text: shown, fontSize: text.size, colour: text.color, bold: text.bold, ...TEXT_LOOK, id, by };
        this.working?.texts.push(placed);
        this.queue({ t: 'place-text', scene: this.ports.scene() ?? '', id, text: { x: placed.x, y: placed.y, text: shown, fontSize: text.size, colour: text.color, bold: text.bold } }, id);
        this.flush();
      });
    }
  }

  private move(global: Point): void {
    const at = this.world(global);
    if (this.tool === 'draw-eraser') this.ring.updatePosition(at.x, at.y);
    if (this.erasing) return this.eraseAt(at);
    if (this.stroke === null) return;
    const last = this.stroke[this.stroke.length - 1];
    // As the GM's pen: a point every 2 world pixels.
    if (last !== undefined && (at.x - last.x) ** 2 + (at.y - last.y) ** 2 < 4) return;
    this.stroke.push(at);
    const { color, width } = this.ports.settings.get().draw;
    drawStroke(this.preview, this.stroke, color, width, 1);
  }

  private up(): void {
    if (this.erasing) {
      this.erasing = false;
      this.flush();
    }
    const stroke = this.stroke;
    this.stroke = null;
    this.preview.clear();
    if (stroke === null || stroke.length === 0 || this.begin() === null) return;
    const { color, width } = this.ports.settings.get().draw;
    this.addPen(stroke, color, width);
    this.flush();
  }

  /** A pen stroke, in pieces a message holds, each beginning where the last ended. */
  private addPen(points: readonly Point[], colour: string, width: number): void {
    for (let start = 0; start === 0 || start < points.length - 1; start += MAX_STROKE_POINTS - 1) {
      const piece = points.slice(start, start + MAX_STROKE_POINTS).flatMap((point) => [rounded(point.x), rounded(point.y)]);
      this.addDrawing({ type: 'pen', points: piece, colour, width, opacity: 1 });
    }
  }

  private addDrawing(drawing: Omit<SharedDrawing, 'id' | 'by'>): void {
    const id = randomId();
    const by = this.ports.self() ?? '';
    this.working?.drawings.push({ ...drawing, id, by });
    const stroke = { type: drawing.type, points: drawing.points, colour: drawing.colour, width: drawing.width, ...(drawing.icon !== undefined && { icon: drawing.icon }) };
    this.queue({ t: 'draw', scene: this.ports.scene() ?? '', id, drawing: stroke }, id);
  }

  /** Rubs out the player's own ink under the brush, as the GM's eraser: a stroke keeps what lies outside it. */
  private eraseAt(at: Point): void {
    const working = this.begin();
    if (working === null) return;
    const radius = this.ports.settings.get().draw.eraserWidth / 2;
    for (const drawing of [...working.drawings]) {
      if (drawing.id === undefined) continue;
      if (drawing.type === 'icon') {
        const reach = radius + drawing.width / 2 + ERASER_SLACK;
        const [x = 0, y = 0] = drawing.points;
        if ((at.x - x) ** 2 + (at.y - y) ** 2 <= reach * reach) this.remove(drawing.id);
        continue;
      }
      const fragments = splitStrokeByBrush(pairs(drawing.points), at, radius + drawing.width / 2);
      if (fragments === null) continue;
      this.remove(drawing.id);
      for (const fragment of fragments) if (fragment.length > 0) this.addPen(fragment, drawing.colour, drawing.width);
    }
    for (const text of [...working.texts]) {
      if (text.id !== undefined && (at.x - text.x) ** 2 + (at.y - text.y) ** 2 <= (radius + text.fontSize / 2) ** 2) this.remove(text.id);
    }
    this.annotations.setLocal({ by: this.ports.self() ?? '', ...working });
    this.flushTimer ??= window.setTimeout(() => this.flush(), ERASE_FLUSH_MS);
  }

  /** The player's own drawings and texts to work on: this page's copy, else the GM's as last sent. */
  private begin(): { drawings: SharedDrawing[]; texts: SharedText[] } | null {
    const self = this.ports.self();
    if (self === null || this.ports.scene() === null) return null;
    if (this.working === null) {
      const own = this.annotations.own(self);
      this.working = { drawings: [...own.drawings], texts: [...own.texts] };
    }
    return this.working;
  }

  private remove(id: string | undefined): void {
    if (id === undefined || this.working === null) return;
    this.working.drawings = this.working.drawings.filter((drawing) => drawing.id !== id);
    this.working.texts = this.working.texts.filter((text) => text.id !== id);
    // What never reached the GM is simply not sent.
    if (this.queued.delete(id)) return void this.expectPresent.delete(id);
    this.erased.add(id);
    this.expectPresent.delete(id);
    this.expectAbsent.add(id);
  }

  private queue(message: PlayerAnnotationMessage, id: string): void {
    this.queued.set(id, message);
    this.expectPresent.add(id);
  }

  /** Sends what is waiting (what was added before what was taken back) and shows the page's copy until the GM's holds it. */
  private flush(): void {
    window.clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const scene = this.ports.scene();
    if (scene === null) return this.clear();
    for (const message of this.queued.values()) this.ports.send({ ...message, scene });
    this.queued.clear();
    const erased = [...this.erased];
    this.erased.clear();
    for (let start = 0; start < erased.length; start += MAX_ERASE_IDS) this.ports.send({ t: 'erase', scene, ids: erased.slice(start, start + MAX_ERASE_IDS) });
    if (this.working !== null) this.annotations.setLocal({ by: this.ports.self() ?? '', ...this.working });
    window.clearTimeout(this.settleTimer);
    this.settleTimer = window.setTimeout(() => this.settle(), SETTLE_MS);
  }

  /** The GM's annotations: once they hold what this page sent, the page shows them as they are. */
  private heard(shown: SharedAnnotations): void {
    if (this.working === null || this.erasing || this.queued.size > 0) return;
    const ids = new Set<string>();
    for (const drawing of shown.drawings) if (drawing.id !== undefined) ids.add(drawing.id);
    for (const text of shown.texts) if (text.id !== undefined) ids.add(text.id);
    if ([...this.expectPresent].every((id) => ids.has(id)) && [...this.expectAbsent].every((id) => !ids.has(id))) this.settle();
  }

  private settle(): void {
    window.clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    this.working = null;
    this.expectPresent.clear();
    this.expectAbsent.clear();
    this.annotations.setLocal(null);
  }
}

/** The small field where the player types a text, at the place they clicked; resolves with the text or null. */
export function askText(host: HTMLElement, screen: Point): Promise<string | null> {
  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.className = 'player-text-input';
    form.dataset.keepsLogOpen = '';
    form.style.left = `${screen.x}px`;
    form.style.top = `${screen.y}px`;
    const input = document.createElement('input');
    input.maxLength = MAX_PLAYER_TEXT;
    input.placeholder = TEXT.toolbar.textPlaceholder;
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.textContent = TEXT.toolbar.textAdd;
    form.append(input, ok);
    let done = false;
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      form.remove();
      resolve(value);
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      finish(input.value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') finish(null);
    });
    input.addEventListener('blur', () => window.setTimeout(() => finish(input.value.trim() === '' ? null : input.value), 150));
    host.append(form);
    // The press that opened it is still going on; the field takes the focus once it is over.
    window.setTimeout(() => input.focus(), 0);
  });
}
