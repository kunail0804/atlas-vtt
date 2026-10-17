import type { Viewport } from 'pixi-viewport';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import { MARKS_INTERVAL_MS, MAX_KEPT, MAX_MARK_LASER_NUMBERS, type MarkPoint, type MarkShape, type MarksMessage, type MeasureState, type SharedCursor, type SharedMeasure } from '../../../src/app/online/protocol/marks.ts';
import type { RulesMessage } from '../../../src/app/online/protocol/rules.ts';
import { CursorOverlay, CursorTap, MarkOverlay, PointerTap, type MeasureRules, type RemoteLaser, type RemoteMeasure } from '../../../src/app/online/marks/index.ts';
import type { PlayerTool, ToolSettingsStore } from './toolSettings.ts';

/** The shape each measure tool draws, as the GM's (`MEASURE_SHAPES`). */
const SHAPES: Partial<Record<PlayerTool, MarkShape>> = { measure: 'line', 'measure-circle': 'circle', 'measure-cone': 'cone' };

const FALLBACK_ACCENT = '#7c8cff';

/**
 * Everyone's lasers, measurements and cursors, drawn with the plugin's own overlays, and this
 * player's own: the laser and the ruler of the toolbar, and the cursor while the GM shares cursors.
 * What the GM sends back of this player's marks is left out; they are drawn here at once.
 */
export class MarksView {
  private readonly viewport: Viewport;
  private readonly canvas: HTMLCanvasElement;
  private readonly send: (message: PlayerMessage) => void;
  private readonly self: () => string | null;
  private readonly scene: () => string | null;
  private readonly marks: MarkOverlay;
  private readonly cursors: CursorOverlay;
  private readonly laser: PointerTap;
  private cursorTap: CursorTap | null = null;
  private measureRules: MeasureRules | null = null;
  private accent = FALLBACK_ACCENT;
  private tool: PlayerTool = 'move';
  private readonly settings: ToolSettingsStore;
  /** The measurements the player keeps on the map while "Persist Measurements" is on. */
  private kept: SharedMeasure[] = [];
  private remoteLasers: readonly RemoteLaser[] = [];
  private remoteMeasures: readonly RemoteMeasure[] = [];
  private ownLaser: RemoteLaser | null = null;
  private ownMeasure: MeasureState | null = null;
  private measureStart: MarkPoint | null = null;
  private lastCursor = '';
  private names = new Map<string, string>();

  constructor(viewport: Viewport, canvas: HTMLCanvasElement, send: (message: PlayerMessage) => void, self: () => string | null, scene: () => string | null, settings: ToolSettingsStore) {
    this.viewport = viewport;
    this.settings = settings;
    // Kept measurements go when the player stops keeping them, as the GM's do.
    settings.subscribe(() => {
      if (!settings.get().measure.persist && this.kept.length > 0) this.clearKept();
    });
    this.canvas = canvas;
    this.send = send;
    this.self = self;
    this.scene = scene;
    this.marks = new MarkOverlay(() => this.measureRules);
    this.cursors = new CursorOverlay((cursor) => cursor.name ?? this.names.get(cursor.who) ?? 'MJ');
    this.laser = new PointerTap(viewport, canvas, () => this.tool === 'laser');
    viewport.on('pointerdown', (event) => this.measureDown(event.button, event.global));
    viewport.on('globalpointermove', (event) => this.measureMove(event.global));
    window.addEventListener('pointerup', () => this.measureUp());
    window.setInterval(() => this.tick(), MARKS_INTERVAL_MS);
  }

  setTool(tool: PlayerTool): void {
    this.tool = tool;
    // The map pans with the left button only while moving; every other tool takes it.
    if (tool === 'move') this.viewport.plugins.resume('drag');
    else this.viewport.plugins.pause('drag');
  }

  /** Takes every kept measurement off the map. */
  clearKept(): void {
    this.kept = [];
    this.ownMeasure = this.measureStart === null ? null : this.ownMeasure;
    const scene = this.scene();
    if (scene !== null) this.send({ t: 'measure', scene, color: this.accent, live: null, kept: [] });
    this.draw();
  }

  rules(message: RulesMessage): void {
    if (message.scene !== this.scene()) return;
    this.measureRules = { grid: { type: message.grid.type, size: message.grid.size, offsetX: message.grid.offsetX, offsetY: message.grid.offsetY }, measurement: { ...message.measurement } };
    this.accent = message.accent ?? FALLBACK_ACCENT;
    if (message.cursors === true && this.cursorTap === null) this.cursorTap = new CursorTap(this.viewport, this.canvas);
    if (message.cursors !== true && this.cursorTap !== null) {
      this.cursorTap.destroy();
      this.cursorTap = null;
      this.sendCursor(null, [], undefined);
    }
  }

  setNames(names: ReadonlyMap<string, string>): void {
    this.names = new Map(names);
  }

  receive(message: MarksMessage): void {
    if (message.scene !== this.scene()) return;
    const self = this.self();
    this.remoteLasers = message.lasers.filter((laser) => laser.who !== self);
    this.remoteMeasures = message.measures.filter((measure) => measure.who !== self);
    this.draw();
    const cursors: SharedCursor[] = (message.cursors ?? []).filter((cursor) => cursor.who !== self);
    this.cursors.show(cursors, { canvas: this.canvas, viewport: this.viewport });
  }

  /** A new scene: every mark goes. */
  clear(): void {
    this.remoteLasers = [];
    this.remoteMeasures = [];
    this.ownMeasure = null;
    this.kept = [];
    this.measureStart = null;
    this.draw();
    this.cursors.clear();
  }

  private draw(): void {
    const self = this.self() ?? 'me';
    const lasers = this.ownLaser === null ? this.remoteLasers : [...this.remoteLasers, this.ownLaser];
    const own = this.ownMeasure ?? (this.kept.length > 0 ? { color: this.accent, live: null, kept: this.kept } : null);
    const measures = own === null ? this.remoteMeasures : [...this.remoteMeasures, { who: self, ...own }];
    this.marks.show({ lasers, measures }, { canvas: this.canvas, viewport: this.viewport });
  }

  private world(global: { x: number; y: number }): MarkPoint {
    const point = this.viewport.toWorld(global);
    return [point.x, point.y];
  }

  private measureDown(button: number, global: { x: number; y: number }): void {
    const shape = SHAPES[this.tool];
    if (shape === undefined || button !== 0) return;
    this.measureStart = this.world(global);
    this.ownMeasure = { color: this.accent, live: { shape, a: this.measureStart, b: this.measureStart }, kept: this.kept };
  }

  private measureMove(global: { x: number; y: number }): void {
    if (this.measureStart === null || this.ownMeasure?.live == null) return;
    this.ownMeasure = { ...this.ownMeasure, live: { ...this.ownMeasure.live, b: this.world(global) } };
  }

  private measureUp(): void {
    if (this.measureStart === null) return;
    const live = this.ownMeasure?.live ?? null;
    this.measureStart = null;
    // A measurement the player keeps stays on the map (the oldest goes past `MAX_KEPT`); a click without a drag keeps nothing.
    if (live !== null && this.settings.get().measure.persist && (live.a[0] !== live.b[0] || live.a[1] !== live.b[1])) this.kept = [...this.kept, live].slice(-MAX_KEPT);
    this.ownMeasure = { color: this.accent, live: null, kept: this.kept };
    this.sendMeasure();
    this.ownMeasure = null;
    this.draw();
  }

  private sendMeasure(): void {
    const scene = this.scene();
    if (scene === null || this.ownMeasure === null) return;
    this.send({ t: 'measure', scene, color: this.ownMeasure.color, live: this.ownMeasure.live, kept: this.kept });
  }

  private sendCursor(at: MarkPoint | null, pts: readonly number[], span: number | undefined): void {
    const scene = this.scene();
    if (scene === null) return;
    this.send({ t: 'cursor', scene, at, pts, ...(span === undefined ? {} : { span }) });
  }

  /** Every marks interval: what moved goes out, as the GM's own marks do. */
  private tick(): void {
    const scene = this.scene();
    if (scene === null) return;
    const state = this.laser.state();
    const trail = this.laser.takeTrail(MAX_MARK_LASER_NUMBERS);
    const { color, size } = this.settings.get().laser;
    if (state.on || trail.pts.length > 0 || this.ownLaser?.on === true) {
      const laser = { color, size, at: state.at, pts: trail.pts, on: state.on, ...(trail.span === null ? {} : { span: trail.span }) };
      this.send({ t: 'laser', scene, ...laser });
      this.ownLaser = state.on || trail.pts.length > 0 ? { who: this.self() ?? 'me', ...laser } : null;
      this.draw();
    }
    if (this.measureStart !== null) {
      this.sendMeasure();
      this.draw();
    }
    if (this.cursorTap !== null) {
      const at = this.cursorTap.at();
      const taken = this.cursorTap.take(MAX_MARK_LASER_NUMBERS);
      const key = `${at?.join(',') ?? 'none'}|${taken.pts.length}`;
      if (key !== this.lastCursor || taken.pts.length > 0) {
        this.lastCursor = key;
        this.sendCursor(at, taken.pts, taken.span ?? undefined);
      }
    }
  }
}
