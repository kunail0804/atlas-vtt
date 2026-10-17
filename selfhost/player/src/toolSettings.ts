import { ICON_WIDTH, PEN_WIDTH, TEXT_SIZE } from '../../../src/app/online/protocol/annotate.ts';
import { resolveLaserPointerSettings, type LaserPointerSettings } from '../../../src/app/tools/laserPointerSettings.ts';

export type PlayerTool = 'move' | 'laser' | 'draw-pen' | 'draw-icon' | 'draw-eraser' | 'text' | 'measure' | 'measure-circle' | 'measure-cone';

/** What the player's tools work with, as the GM's toolbar menus set theirs. */
export interface ToolSettings {
  readonly laser: LaserPointerSettings;
  readonly draw: { readonly color: '#ffffff' | '#000000'; readonly width: number; readonly icon: string; readonly eraserWidth: number };
  readonly text: { readonly color: string; readonly size: number; readonly bold: boolean };
  readonly measure: { readonly persist: boolean };
}

const KEY = 'atlas-vtt:tools';
const DEFAULTS: ToolSettings = {
  laser: resolveLaserPointerSettings(undefined),
  draw: { color: '#ffffff', width: 4, icon: 'door-open', eraserWidth: 40 },
  text: { color: '#ffffff', size: 24, bold: false },
  measure: { persist: false },
};

const within = (value: unknown, min: number, max: number, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback);
const colour = (value: unknown, fallback: string): string => (typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value) ? value : fallback);

/** Stored settings, anything unusable replaced by the default. */
function read(raw: unknown): ToolSettings {
  const stored = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, Record<string, unknown> | undefined>;
  const draw = stored.draw ?? {};
  const text = stored.text ?? {};
  return {
    laser: resolveLaserPointerSettings(stored.laser as Partial<LaserPointerSettings> | undefined),
    draw: {
      color: draw.color === '#000000' ? '#000000' : '#ffffff',
      width: within(draw.width, PEN_WIDTH.min, PEN_WIDTH.max, DEFAULTS.draw.width),
      icon: typeof draw.icon === 'string' && /^[a-z0-9-]{1,40}$/.test(draw.icon) ? draw.icon : DEFAULTS.draw.icon,
      eraserWidth: within(draw.eraserWidth, 10, 200, DEFAULTS.draw.eraserWidth),
    },
    text: { color: colour(text.color, DEFAULTS.text.color), size: within(text.size, TEXT_SIZE.min, TEXT_SIZE.max, DEFAULTS.text.size), bold: text.bold === true },
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

/** The width an icon stamp takes on the map, as the GM's stamp does (`MAP_ICON_SIZE`), within what the GM takes. */
export const iconWidth = (size: number): number => Math.min(ICON_WIDTH.max, Math.max(ICON_WIDTH.min, size));
