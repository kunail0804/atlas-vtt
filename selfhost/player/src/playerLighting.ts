import { Graphics } from 'pixi.js';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { SharedLightingScene, SharedSight } from '../../../src/app/online/protocol/lighting.ts';
import type { MeasurementSettings } from '../../../src/app/grid/measurementFormat.ts';
import { LIGHTING_Z_INDEX, LightingRenderer, type LightingState } from '../../../src/app/pixi/lighting/LightingRenderer.ts';
import type { SightRules } from '../../../src/app/vision/sightRules.ts';
import { litScene } from './litScene.ts';
import type { Stage } from './stage.ts';

/** Above the lighting layer: what covers the map while the players' picture cannot be trusted. */
const CURTAIN_Z = LIGHTING_Z_INDEX + 5;
const CURTAIN_MARGIN = 100_000;

function measurementOf(unitDistance: number): MeasurementSettings {
  return { mode: 'metric', unitType: 'units', unitDistance, ruleDistance: unitDistance, diagonalRule: 'equidistant', rangeBands: [], coneAngle: 53 };
}

/**
 * Dynamic lighting for a lit scene, with the plugin's own engine (`LightingRenderer`) in the
 * players' view: the scene is rebuilt from the GM's `lighting` and `sight` messages, and what no
 * token sees stays dark. It fails closed: a black curtain covers the map until the engine has worked
 * the players' sight out from both messages, and again for good if the engine cannot light the map.
 */
export class PlayerLighting {
  private readonly stage: Stage;
  private readonly store: StoreApi<LightingState>;
  private readonly curtain: Graphics;
  private readonly unavailable: () => void;
  private renderer: LightingRenderer | null = null;
  private scene: SharedLightingScene | null = null;
  private sight: SharedSight | null = null;
  private rules: SightRules = { definitions: [], conditions: [] };
  private unitDistance = 5;
  private bounds: { width: number; height: number } | null = null;
  private failed = false;
  private readonly watch = (): void => this.lift();

  constructor(stage: Stage, mapPath: string, unavailable: () => void) {
    this.stage = stage;
    this.unavailable = unavailable;
    stage.viewport.sortableChildren = true;
    this.curtain = new Graphics().rect(-CURTAIN_MARGIN, -CURTAIN_MARGIN, CURTAIN_MARGIN * 2, CURTAIN_MARGIN * 2).fill({ color: 0x000000 });
    this.curtain.zIndex = CURTAIN_Z;
    this.curtain.eventMode = 'none';
    stage.viewport.addChild(this.curtain);
    this.store = createStore<LightingState>(() => ({
      objects: { tokens: {}, walls: {}, lights: {}, lightZones: {} },
      lighting: { enabled: true, ambient: 0 },
      grid: null,
      heldTokens: {},
      background: null,
      widgetValues: {},
      mapPath,
      isMapLoading: true,
      exploredEdits: 0,
      exploredMask: null,
      // The GM keeps the explored memory; this page only shows the one it is sent.
      setExploredMask: () => undefined,
      setExploredEdits: () => undefined,
    }));
    stage.app.ticker.add(this.watch);
  }

  /** The map's size: the lighting covers the world `[0, width] × [0, height]`. */
  setBounds(width: number, height: number): void {
    this.bounds = { width, height };
    this.renderer?.refreshBounds();
    this.update();
  }

  setScene(scene: SharedLightingScene): void {
    this.scene = scene;
    this.update();
  }

  setSight(sight: SharedSight): void {
    this.sight = sight;
    this.update();
  }

  /** The explored memory the GM last saved, as a PNG data URL; null for none. */
  setExplored(dataUrl: string | null): void {
    this.store.setState({ exploredMask: dataUrl });
  }

  destroy(): void {
    this.stage.app.ticker.remove(this.watch);
    this.renderer?.destroy();
    this.renderer = null;
    this.curtain.destroy();
  }

  private update(): void {
    if (this.failed || this.scene === null || this.sight === null || this.bounds === null) return;
    const built = litScene(this.scene, this.sight);
    this.rules = built.rules;
    this.unitDistance = built.unitDistance;
    this.store.setState({ ...built.state, isMapLoading: false });
    if (this.renderer === null) {
      this.renderer = new LightingRenderer({
        viewport: this.stage.viewport, app: this.stage.app, store: this.store,
        measurement: () => measurementOf(this.unitDistance),
        bounds: () => this.bounds,
        albedo: () => null,
        rules: () => this.rules,
        onUnavailable: () => this.fail(),
      });
      this.renderer.modeLayer.visible = true;
    }
  }

  /** Lifts the curtain once the engine's sight is the scene's; lowers it again whenever it is not. */
  private lift(): void {
    const ready = !this.failed && this.renderer !== null && this.renderer.isEnabled() && this.renderer.sightIsCurrent();
    this.curtain.visible = !ready;
  }

  private fail(): void {
    this.failed = true;
    this.curtain.visible = true;
    this.renderer?.destroy();
    this.renderer = null;
    this.unavailable();
  }
}
