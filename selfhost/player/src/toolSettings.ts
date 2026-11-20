import { DRAW_SIZES, type DrawSize } from '../../../src/app/annotations/annotationTypes.ts';
import { stampGlyph } from '../../../src/app/pixi/mapIcons.ts';
import { resolveLaserPointerSettings, type LaserPointerSettings } from '../../../src/app/tools/laserPointerSettings.ts';

export type PlayerTool = 'move' | 'laser' | 'draw-pen' | 'draw-icon' | 'draw-eraser' | 'text' | 'measure' | 'measure-circle' | 'measure-cone';

/**
 * What the player's tools work with, as the GM's toolbar menus set theirs. Sizes are the Draw
 * tool's named sizes (shares of the map's cell), which the GM's Atlas turns into pixels.
 */
export interface ToolSettings {
  readonly laser: LaserPointerSettings;
  readonly draw: { readonly color: '#ffffff' | '#000000'; readonly size: DrawSize; readonly icon: string; readonly eraserSize: DrawSize };
  readonly text: { readonly color: string; readonly size: DrawSize; readonly bold: boolean };
  readonly measure: { readonly persist: boolean };
}

const KEY = 'atlas-vtt:tools';
const DEFAULTS: ToolSettings = {
  laser: resolveLaserPointerSettings(undefined),
  draw: { color: '#ffffff', size: 'm', icon: 'door-open', eraserSize: 'm' },
  text: { color: '#ffffff', size: 'm', bold: false },
  measure: { persist: false },
};

const sizeOr = (value: unknown, fallback: DrawSize): DrawSize => (DRAW_SIZES.includes(value as DrawSize) ? (value as DrawSize) : fallback);
const colour = (value: unknown, fallback: string): string => (typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value) ? value : fallback);

/** Stored settings, anything unusable replaced by the default (widths an older page stored in pixels among them). */
function read(raw: unknown): ToolSettings {
  const stored = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const draw = stored.draw ?? {};
  const text = stored.text ?? {};
  return {
    laser: resolveLaserPointerSettings(stored.laser as Partial<LaserPointerSettings> | undefined),
    draw: {
      color: draw.color === '#000000' ? '#000000' : '#ffffff',
      size: sizeOr(draw.size, DEFAULTS.draw.size),
      icon: typeof draw.icon === 'string' && stampGlyph(draw.icon) !== null ? draw.icon : DEFAULTS.draw.icon,
      eraserSize: sizeOr(draw.eraserSize, DEFAULTS.draw.eraserSize),
    },
    text: { color: colour(text.color, DEFAULTS.text.color), size: sizeOr(text.size, DEFAULTS.text.size), bold: text.bold === true },
    measure: { persist: stored.measure?.persist === true },
  };
}

/** The settings, kept in this browser, and who listens to them. */
export class ToolSettingsStore {
  private value: ToolSettings;
  private readonly listeners = new Set<() => void>();

  constructor() {
    let raw: unknown = undefined;
    try {
      raw = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    } catch {
      raw = undefined;
    }
    this.value = read(raw);
  }

  readonly get = (): ToolSettings => this.value;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  update<K extends keyof ToolSettings>(part: K, change: Partial<ToolSettings[K]>): void {
    this.value = read({ ...this.value, [part]: { ...this.value[part], ...change } });
    window.localStorage.setItem(KEY, JSON.stringify(this.value));
    for (const listener of this.listeners) listener();
  }
}
