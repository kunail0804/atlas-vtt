import type { GmMessage, SharedScene } from '../../../src/app/online/protocol/game.ts';
import type { SharedFog } from '../../../src/app/online/protocol/fog.ts';
import type { SharedGrid } from '../../../src/app/online/protocol/mapLayers.ts';
import { GridSystem } from '../../../src/app/grid/GridSystem.ts';
import type { AssetLoader } from './assets.ts';
import { FogLayer } from './fogLayer.ts';
import { MapLayer } from './mapLayer.ts';
import { frame, type Stage } from './stage.ts';
import type { TokenLayer } from './tokenLayer.ts';

/** The map is asked for at most this large; a larger one comes as a scaled copy drawn at its own size. */
const MAP_SIDE = 8192;

/** What the page tells the player about the scene, outside the canvas. */
export type SceneNotice = 'none' | 'no-scene' | 'loading' | 'lit' | 'map-failed';

/**
 * The shared scene on the canvas: the map, the grid, the tokens and the fog, as the GM's messages
 * say. A lit scene shows nothing yet: players may see only what the lighting shows, and this page
 * does not draw lighting, so it never shows the map unlit.
 */
export class SceneView {
  private readonly stage: Stage;
  private readonly assets: AssetLoader;
  private readonly tokens: TokenLayer;
  private readonly map: MapLayer;
  private readonly fog: FogLayer;
  private readonly notice: (notice: SceneNotice) => void;
  /** Called when another scene (or none) is shown, for what lives beside the canvas. */
  onSceneChange: () => void = () => undefined;
  private grid: GridSystem | null = null;
  private scene: SharedScene | null = null;
  private lastFog: SharedFog | undefined;
  private lastGrid: SharedGrid | null = null;

  constructor(stage: Stage, assets: AssetLoader, tokens: TokenLayer, notice: (notice: SceneNotice) => void) {
    this.stage = stage;
    this.assets = assets;
    this.tokens = tokens;
    this.map = new MapLayer(stage.map);
    this.fog = new FogLayer(stage.fog);
    this.notice = notice;
    notice('no-scene');
  }

  get sceneId(): string | null {
    return this.scene?.id ?? null;
  }

  receive(message: GmMessage): void {
    switch (message.t) {
      case 'scene':
        return this.showScene(message.scene);
      case 'tokens':
        if (this.visible(message.scene)) this.tokens.show(message.tokens);
        return;
      case 'mine':
        if (message.scene === this.sceneId) this.tokens.setMine(message.tokens);
        return;
      case 'fog':
        if (message.scene !== this.sceneId) return;
        this.lastFog = message.fog;
        return this.drawFog();
      case 'grid':
        if (message.scene !== this.sceneId) return;
        this.lastGrid = message.grid;
        return this.drawGrid();
      case 'live':
        if (this.visible(message.scene)) this.tokens.live(message.tokens);
        return;
      case 'move-refused':
        if (message.scene === this.sceneId) this.tokens.refused(message.id, message.x, message.y);
        return;
      default:
        return;
    }
  }

  private visible(scene: string): boolean {
    return this.scene !== null && scene === this.scene.id && !this.scene.lit;
  }

  private showScene(scene: SharedScene | null): void {
    if (scene !== null && this.scene !== null && scene.id === this.scene.id && scene.lit === this.scene.lit && scene.map?.hash === this.scene.map?.hash) return;
    this.scene = scene;
    this.lastFog = undefined;
    this.onSceneChange();
    this.tokens.reset(scene?.id ?? null);
    this.fog.clear();
    this.map.show(null);
    this.drawGrid();
    if (scene === null) return this.notice('no-scene');
    if (scene.lit) return this.notice('lit');
    if (scene.map === null) return this.notice('none');
    this.notice('loading');
    const id = scene.id;
    this.assets.image(scene.map, MAP_SIDE).then((image) => {
      if (this.scene?.id !== id) return;
      this.map.show(image);
      frame(this.stage, image.width, image.height);
      this.drawFog();
      this.drawGrid();
      this.notice('none');
    }).catch(() => {
      if (this.scene?.id === id) this.notice('map-failed');
    });
  }

  private drawFog(): void {
    const rect = this.map.worldRect;
    if (rect === null || this.lastFog === undefined || this.scene?.lit !== false) return;
    this.fog.show(this.lastFog, rect.width, rect.height);
  }

  private drawGrid(): void {
    const grid = this.lastGrid;
    if (grid === null || this.map.worldRect === null || this.scene?.lit !== false) {
      this.grid?.destroy();
      this.grid = null;
      return;
    }
    const options = {
      type: grid.type, size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY,
      color: grid.colour === null ? undefined : Number.parseInt(grid.colour.slice(1), 16),
      alpha: grid.alpha, lineWidth: grid.lineWidth, lineType: grid.lineType, enabled: true,
      cellNumbers: grid.numbers === null ? undefined : { format: grid.numbers.format, opacity: grid.numbers.opacity },
    };
    if (this.grid === null) this.grid = new GridSystem(this.stage.app, this.stage.viewport, this.map, options);
    else this.grid.updateOptions(options);
  }
}
