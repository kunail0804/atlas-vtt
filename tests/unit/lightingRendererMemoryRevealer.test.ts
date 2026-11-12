// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container, type Application } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { createViewAtlasStore, type ViewAtlasStore } from '../../src/app/storeFactory';
import { LightingRenderer } from '../../src/app/pixi/lighting/LightingRenderer';
import type { TokenEntity } from '../../src/app/types';
import type { SceneLightingChanges } from '../../src/app/types/lightingTypes';
import type { MapBounds } from '../../src/app/vision/visibility';
import { createInMemoryApp } from '../mocks/inMemoryVault';

/** What the view handed the explored memory to record. */
const memory = vi.hoisted(() => ({ recorded: [] as unknown[] }));

// The view works its sight out on the CPU and hands what the tokens saw to the explored memory,
// which draws. The engine and the memory are left out: this suite holds what the view records.
vi.mock('../../src/app/pixi/lighting/engine/LightingEngine', async () => ({
  LightingEngine: (await import('../helpers/lightingRendererStubs')).stubLightingEngine(),
}));
vi.mock('../../src/app/pixi/lighting/ExploredMemory', async () => ({
  ExploredMemory: (await import('../helpers/lightingRendererStubs')).stubExploredMemory((shapes) => memory.recorded.push(shapes)),
}));

const MAP: MapBounds = { width: 1000, height: 1000 };
const hero = (x: number): TokenEntity => ({ id: 'hero', kind: 'token', imagePath: 'h.png', x, y: 100, vision: { enabled: true, range: 10 } });

interface Lit {
  store: ViewAtlasStore;
  moveHero: (x: number) => void;
}

let view: LightingRenderer | undefined;
afterEach(() => {
  view?.destroy();
  view = undefined;
  memory.recorded = [];
});

/** The engine's view over a scene in daylight whose hero, a vision token, stands at x 100. */
function lit(lighting: SceneLightingChanges): Lit {
  const { app: obsApp } = createInMemoryApp();
  const store = createViewAtlasStore(obsApp, `lighting-memory-revealer-${Math.random()}`);
  store.setState({ persistenceEnabled: false, objects: { ...store.getState().objects, tokens: { hero: hero(100) } } });
  store.getState().setSceneLighting({ enabled: true, ambient: 1, ...lighting });
  const renderer = { name: 'webgl', gl: { isContextLost: () => false, finish: () => undefined }, canvas: document.createElement('canvas') };
  const app = { renderer, ticker: { add: () => undefined, remove: () => undefined } };
  view = new LightingRenderer({
    viewport: new Container() as unknown as Viewport,
    app: app as unknown as Application,
    store,
    measurement: () => ({ mode: 'grid', unitType: 'feet', unitDistance: 5, diagonalRule: 'chebyshev', rangeBands: [] }) as never,
    bounds: () => MAP,
    albedo: () => null,
  });
  return {
    store,
    moveHero: (x) => store.setState((state) => ({ objects: { ...state.objects, tokens: { hero: hero(x) } } })),
  };
}

describe('who fills the explored memory of a lit scene', () => {
  it('is the GM in a scene that sets nothing: tokens that move record nothing', () => {
    const { moveHero } = lit({});
    moveHero(300);
    moveHero(500);
    expect(memory.recorded).toEqual([]);
  });

  it('is the GM where the scene says so', () => {
    const { moveHero } = lit({ exploredBy: 'gm' });
    moveHero(300);
    expect(memory.recorded).toEqual([]);
  });

  it('is the players where the scene says so: what their tokens see is recorded at every move', () => {
    const { moveHero } = lit({ exploredBy: 'players' });
    expect(memory.recorded).toHaveLength(1);
    moveHero(300);
    expect(memory.recorded).toHaveLength(2);
  });

  it('records what the tokens see at once when the GM hands the memory to the players, and nothing more once the GM takes it back', () => {
    const { store, moveHero } = lit({});
    store.getState().setSceneLighting({ exploredBy: 'players' });
    expect(memory.recorded).toHaveLength(1);
    store.getState().setSceneLighting({ exploredBy: undefined });
    moveHero(300);
    expect(memory.recorded).toHaveLength(1);
  });
});
