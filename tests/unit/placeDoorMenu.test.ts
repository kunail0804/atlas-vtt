// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextMenuEntry } from '../../src/app/react/root/ContextMenuContext';
import { showWallMenu, type LightingMenuContext } from '../../src/app/pixi/lighting/lightingMenus';
import { DoorPlacement } from '../../src/app/pixi/vision/DoorPlacement';
import type { WallInteraction } from '../../src/app/pixi/vision/WallInteraction';
import type { WallRenderer } from '../../src/app/pixi/vision/WallRenderer';
import { createViewAtlasStore, type ViewAtlasStore } from '../../src/app/storeFactory';
import { getHistoryStore } from '../../src/app/stores/history';
import type { WallSegment } from '../../src/app/types/wallTypes';
import { createInMemoryApp } from '../mocks/inMemoryVault';

const opened = vi.hoisted(() => ({ entries: [] as ContextMenuEntry[] }));
vi.mock('../../src/app/react/root/ContextMenuContext', () => ({
  openContextMenuGlobal: (entries: ContextMenuEntry[]): void => {
    opened.entries = entries;
  },
}));

const CELL = 70;

afterEach(() => {
  opened.entries = [];
});

/** A room's left wall, ten cells high, under a right-click: the wall menu as the wall tool opens it. */
function setup(): { store: ViewAtlasStore; wallId: string; rightClick: (x: number, y: number) => void; choose: (label: string) => void } {
  const store = createViewAtlasStore(createInMemoryApp({ files: {} }).app, `place-door-${Math.random()}`);
  store.getState().setPersistenceEnabled(false);
  store.getState().setActiveTool('wall');
  store.getState().setGrid({ ...store.getState().grid!, type: 'square', size: CELL });
  store.getState().addWall({ type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 0, y: 10 * CELL } });
  const wallId = Object.keys(store.getState().objects.walls)[0]!;
  getHistoryStore(store)!.getState().clear();

  let selected: string[] = [];
  const walls = {
    getSelectedWallIds: () => selected.filter((id) => store.getState().objects.walls[id]),
    hasSelection: () => selected.some((id) => store.getState().objects.walls[id]),
    selectWallChain: (id: string) => { selected = [id]; },
    selectSegment: (id: string) => { selected = [id]; },
    clearSelection: () => { selected = []; },
  } as unknown as WallInteraction;
  const wallRenderer = {
    hitTestVertices: () => null,
    hitTestWalls: (_x: number, y: number) => (y > 0 && y < 10 * CELL ? wallId : null),
  } as unknown as WallRenderer;
  const context: LightingMenuContext = { store, walls, wallRenderer, doors: new DoorPlacement(store, walls), lightAt: () => null };

  const rightClick = (x: number, y: number): void => showWallMenu(context, x, y, 0, 0);
  const choose = (label: string): void => {
    const entry = opened.entries.find((e) => e.type === 'item' && e.label === label);
    if (!entry || entry.type !== 'item') throw new Error(`No menu entry ${label}`);
    entry.onClick();
  };
  return { store, wallId, rightClick, choose };
}

const wallsOf = (store: ViewAtlasStore): WallSegment[] => Object.values(store.getState().objects.walls);

describe('Place door from the wall menu', () => {
  it('places the door centred on the point right-clicked, at once', () => {
    const { store, rightClick, choose } = setup();
    rightClick(0, 5.3 * CELL);
    choose('Place door');

    const doors = wallsOf(store).filter((wall) => wall.type === 'door');
    expect(doors).toHaveLength(1);
    const door = doors[0]!;
    expect((door.p1.y + door.p2.y) / 2).toBeCloseTo(5.3 * CELL);
    expect(Math.abs(door.p2.y - door.p1.y)).toBeCloseTo(CELL);
    expect(door.closed).toBe(true);
    // The wall is cut around it: one piece above, one below.
    const solids = wallsOf(store).filter((wall) => wall.type === 'solid').map((wall) => [wall.p1.y, wall.p2.y].sort((a, b) => a - b));
    expect(solids).toEqual(expect.arrayContaining([[0, 4.8 * CELL], [5.8 * CELL, 10 * CELL]].map(([a, b]) => [expect.closeTo(a!), expect.closeTo(b!)])));
  });

  it('places a secret door the same way, in one undo step', () => {
    const { store, wallId, rightClick, choose } = setup();
    rightClick(0, 2 * CELL);
    choose('Place secret door');

    const doors = wallsOf(store).filter((wall) => wall.type === 'secret-door');
    expect(doors).toHaveLength(1);
    expect((doors[0]!.p1.y + doors[0]!.p2.y) / 2).toBeCloseTo(2 * CELL);

    getHistoryStore(store)!.getState().undo();
    expect(Object.keys(store.getState().objects.walls)).toEqual([wallId]);
  });
});
