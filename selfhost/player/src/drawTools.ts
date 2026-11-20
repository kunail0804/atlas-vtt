import { Graphics, type Container } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { DEFAULT_DRAW_TOOL, type DrawSize } from '../../../src/app/annotations/annotationTypes.ts';
import { eraserRadius, strokeWidth } from '../../../src/app/annotations/drawSizes.ts';
import { MAX_DRAW_IDS, MAX_DRAW_NUMBERS, MAX_PLAYER_STROKE_POINTS, MAX_PLAYER_TEXT_LENGTH, MAX_SWEEP_POINTS, type PlayerDrawMessage } from '../../../src/app/online/protocol/draw.ts';
import { drawnText } from '../../../src/app/online/protocol/drawParse.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { FogCursorPreview } from '../../../src/app/pixi/fog/FogCursorPreview.ts';
import type { AnnotationsView } from './annotations.ts';
import { TEXT } from './text.ts';
import type { PlayerTool, ToolSettingsStore } from './toolSettings.ts';

type Point = { x: number; y: number };

/** The numbers of a point one message of a drawing's points holds. */
const POINTS_PER_MESSAGE = MAX_DRAW_NUMBERS / 2;
const rounded = (value: number): number => Math.round(value * 10) / 10;
const flat = (points: readonly Point[]): number[] => points.flatMap((point) => [rounded(point.x), rounded(point.y)]);

/** At most `most` of `points`, spread evenly along them, the first and the last kept. */
function spread(points: readonly Point[], most: number): Point[] {
  if (points.length <= most) return [...points];
  const step = (points.length - 1) / (most - 1);
  return Array.from({ length: most }, (_, index) => points[Math.round(index * step)]!);
}

/**
 * A request of the player's Draw tool, without what every one says (`scene`, `n`). The union is
 * spread over its members, so each keeps what tells it apart.
 */
type DrawRequestBody = PlayerDrawMessage extends infer M ? (M extends PlayerDrawMessage ? Omit<M, 'scene' | 'n'> : never) : never;

export interface DrawToolsPorts {
  readonly send: (message: PlayerMessage) => void;
  readonly scene: () => string | null;
  /** The side of the cell the GM's named sizes are shares of while the GM lets players draw (`rules.draw`); null while it does not. */
  readonly cell: () => number | null;
  readonly settings: ToolSettingsStore;
  /** Tells the player something (a notice of the page). */
  readonly notify: (text: string) => void;
  /** Asks for a text where the player clicked, at that place on screen; null when they cancel. */
  readonly askText: (screen: Point) => Promise<string | null>;
}

/**
 * The player's pen, symbol stamp, drawing eraser and text tool. Each gesture is a request of the
 * GM's Atlas (`online/protocol/draw.ts`), which decides, makes the drawing as its own Draw tool
 * would and sends the map's drawings to all: the page shows what it draws while the gesture lasts,
 * and then what the GM sends. The eraser tells its sweep; the GM cuts only the player's own ink.
 */
export class DrawTools {
  private readonly viewport: Viewport;
  private readonly annotations: AnnotationsView;
  private readonly ports: DrawToolsPorts;
  private readonly preview = new Graphics();
  private readonly ring: FogCursorPreview;
  private tool: PlayerTool = 'move';
  private stroke: Point[] | null = null;
  private sweep: Point[] | null = null;
  /** The number of the player's last request; the GM takes only what comes after what it dealt with. */
  private n = 0;

  constructor(viewport: Viewport, layer: Container, annotations: AnnotationsView, ports: DrawToolsPorts) {
    this.viewport = viewport;
    this.annotations = annotations;
    this.ports = ports;
    this.preview.eventMode = 'none';
    layer.addChild(this.preview);
    this.ring = new FogCursorPreview(viewport);
    layer.addChild(this.ring.getDisplayObject());
    ports.settings.subscribe(() => this.syncRing());
    viewport.on('pointerdown', (event) => this.down(event.button, event.global));
    viewport.on('globalpointermove', (event) => this.move(event.global));
    window.addEventListener('pointerup', () => this.up());
  }

  setTool(tool: PlayerTool): void {
    this.up();
    this.tool = tool;
    this.syncRing();
    if (tool === 'draw-eraser') this.ring.show(true);
    else this.ring.hide();
  }

  /** The GM's rules changed: the eraser's ring takes the map's cell. */
  rulesChanged(): void {
    this.syncRing();
  }

  /** Takes back every drawing and text the player made in the scene. */
  deleteMine(): void {
    const own = this.annotations.own();
    const ids = [...own.drawings, ...own.texts];
    for (let start = 0; start < ids.length; start += MAX_DRAW_IDS) this.request({ t: 'draw-remove', ids: ids.slice(start, start + MAX_DRAW_IDS) });
  }

  /** A new scene: nothing of the old one is kept or sent. */
  clear(): void {
    this.stroke = null;
    this.sweep = null;
    this.preview.clear();
  }

  private syncRing(): void {
    const cell = this.ports.cell();
    if (cell !== null) this.ring.setBrushRadius(eraserRadius(this.ports.settings.get().draw.eraserSize, cell));
  }

  private world(global: Point): Point {
    const point = this.viewport.toWorld(global);
    return { x: point.x, y: point.y };
  }

  /** The map's cell while the GM lets players draw; else the player is told, and null. */
  private drawingCell(): number | null {
    const cell = this.ports.cell();
    if (cell === null) this.ports.notify(TEXT.toolbar.drawOff);
    return cell;
  }

  private down(button: number, global: Point): void {
    if (button !== 0 || this.ports.scene() === null || (!this.tool.startsWith('draw') && this.tool !== 'text')) return;
    const cell = this.drawingCell();
    if (cell === null) return;
    const at = this.world(global);
    const { draw, text } = this.ports.settings.get();
    if (this.tool === 'draw-pen') {
      this.stroke = [at];
      this.drawPreview(cell);
    } else if (this.tool === 'draw-icon') {
      this.request({ t: 'draw-stamp', x: rounded(at.x), y: rounded(at.y), icon: draw.icon, look: { colour: draw.color, size: draw.size } });
    } else if (this.tool === 'draw-eraser') {
      this.sweep = [at];
    } else if (this.tool === 'text') {
      void this.ports.askText({ x: global.x, y: global.y }).then((written) => {
        const words = drawnText(written ?? '');
        if (words === null) return;
        this.request({
          t: 'draw-text', x: rounded(at.x), y: rounded(at.y), text: words,
          look: { colour: text.color, size: text.size, font: DEFAULT_DRAW_TOOL.font, look: 'plate', ...(text.bold && { bold: true as const }) },
        });
      });
    }
  }

  private move(global: Point): void {
    const at = this.world(global);
    if (this.tool === 'draw-eraser') this.ring.updatePosition(at.x, at.y);
    const line = this.stroke ?? this.sweep;
    if (line === null) return;
    const last = line[line.length - 1];
    // As the GM's pen: a point every 2 world pixels.
    if (last !== undefined && (at.x - last.x) ** 2 + (at.y - last.y) ** 2 < 4) return;
    line.push(at);
    const cell = this.ports.cell();
    if (this.stroke !== null && cell !== null) this.drawPreview(cell);
  }

  private up(): void {
    const sweep = this.sweep;
    this.sweep = null;
    if (sweep !== null && sweep.length > 0) {
      this.request({ t: 'draw-erase', pts: flat(spread(sweep, MAX_SWEEP_POINTS)), size: this.ports.settings.get().draw.eraserSize });
    }
    const stroke = this.stroke;
    this.stroke = null;
    this.preview.clear();
    if (stroke === null || stroke.length === 0) return;
    const { color, size } = this.ports.settings.get().draw;
    this.sendPen(spread(stroke, MAX_PLAYER_STROKE_POINTS), { colour: color, size });
  }

  /** A pen's stroke: its points beyond what one message holds go ahead of the request that makes it. */
  private sendPen(points: readonly Point[], look: { colour: string; size: DrawSize }): void {
    const scene = this.ports.scene();
    if (scene === null) return;
    const n = this.next();
    let sent = 0;
    while (points.length - sent > POINTS_PER_MESSAGE) {
      this.ports.send({ t: 'draw-points', scene, n, from: sent, pts: flat(points.slice(sent, sent + POINTS_PER_MESSAGE)) });
      sent += POINTS_PER_MESSAGE;
    }
    this.ports.send({ t: 'draw-add', scene, n, mode: 'pen', pts: flat(points.slice(sent)), ...(sent > 0 && { from: sent }), look });
  }

  private request(body: DrawRequestBody): void {
    const scene = this.ports.scene();
    if (scene === null) return;
    this.ports.send({ ...body, scene, n: this.next() } as PlayerDrawMessage);
  }

  private next(): number {
    this.n += 1;
    return this.n;
  }

  private drawPreview(cell: number): void {
    const stroke = this.stroke;
    this.preview.clear();
    if (stroke === null || stroke.length === 0) return;
    const { color, size } = this.ports.settings.get().draw;
    const width = strokeWidth(size, cell);
    const [first, ...rest] = stroke;
    if (rest.length === 0) {
      this.preview.circle(first!.x, first!.y, width / 2).fill({ color });
      return;
    }
    this.preview.moveTo(first!.x, first!.y);
    for (const point of rest) this.preview.lineTo(point.x, point.y);
    this.preview.stroke({ color, width, cap: 'round', join: 'round' });
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
    input.maxLength = MAX_PLAYER_TEXT_LENGTH;
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
