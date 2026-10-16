import { Application, Container } from 'pixi.js';
import { Viewport } from 'pixi-viewport';

/** The players' canvas: a viewport that pans and zooms, holding the scene's layers in drawing order. */
export interface Stage {
  readonly app: Application;
  readonly viewport: Viewport;
  /** The map image; the grid places itself just above it. */
  readonly map: Container;
  readonly tokens: Container;
  /** Drawings and texts, under the fog as in Atlas's players' frame. */
  readonly annotations: Container;
  readonly fog: Container;
  /** Readable pins: only those where players see the map are sent, so they lie above the fog. */
  readonly pins: Container;
}

export async function createStage(host: HTMLElement): Promise<Stage> {
  const app = new Application();
  await app.init({ resizeTo: host, background: '#101114', antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
  host.appendChild(app.canvas);
  const viewport = new Viewport({ screenWidth: host.clientWidth, screenHeight: host.clientHeight, events: app.renderer.events });
  viewport.drag().pinch().wheel().decelerate();
  viewport.clampZoom({ minScale: 0.05, maxScale: 8 });
  app.stage.addChild(viewport);
  const map = new Container();
  const tokens = new Container();
  const annotations = new Container();
  const fog = new Container();
  const pins = new Container();
  // Inside the viewport every child is hit-tested as if it were interactive (Pixi v8 passes the
  // viewport's mode down), so the fog, which covers the map above the tokens, would take every
  // press. The map and the fog take none; panning is the viewport's own.
  map.eventMode = 'none';
  annotations.eventMode = 'none';
  fog.eventMode = 'none';
  viewport.addChild(map, tokens, annotations, fog, pins);
  app.renderer.on('resize', (width: number, height: number) => viewport.resize(width, height));
  return { app, viewport, map, tokens, annotations, fog, pins };
}

/** Frames a world rectangle in the screen, leaving a margin. */
export function frame(stage: Stage, width: number, height: number): void {
  if (width <= 0 || height <= 0) return;
  stage.viewport.fit(true, width * 1.05, height * 1.05);
  stage.viewport.moveCenter(width / 2, height / 2);
}
