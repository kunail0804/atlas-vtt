import type { StoreApi } from 'zustand';
import type { ViewAtlasState } from '../../storeFactory';
import { runHistoryTransaction } from '../../stores/history';
import type { Point } from '../../types/visionTypes';
import { placeDoor } from '../lighting/wallEdits';
import type { WallInteraction } from './WallInteraction';
import { levelObjects } from '../../levels/levelObjects';

type DoorType = 'door' | 'secret-door';

/** World pixels: how wide a door is on a map without a grid. */
const DOOR_WIDTH_WITHOUT_GRID = 40;

/**
 * Placing a door in a wall from the wall menu: the door, one grid cell wide, is centred on the
 * point of the wall nearest the one clicked (`placeDoor`), which splits the wall around it in
 * one undo step.
 */
export class DoorPlacement {
  constructor(
    private readonly store: StoreApi<ViewAtlasState>,
    private readonly walls: WallInteraction,
  ) {}

  /** Places a door in `wallId`, centred on the point of the wall nearest `at` (its middle without one). */
  place(wallId: string, doorType: DoorType, at?: Point): void {
    const wall = levelObjects(this.store.getState()).walls[wallId];
    if (!wall) return;
    const centre = at ?? { x: (wall.p1.x + wall.p2.x) / 2, y: (wall.p1.y + wall.p2.y) / 2 };
    const state = this.store.getState();
    runHistoryTransaction(this.store, () => {
      state.deleteWall(wall.id);
      for (const piece of placeDoor(wall, centre, this.width(), doorType)) state.addWall(piece);
    });
    this.walls.clearSelection();
  }

  /** A door is one grid cell wide. */
  private width(): number {
    const size = this.store.getState().grid?.size ?? 0;
    return size > 0 ? size : DOOR_WIDTH_WITHOUT_GRID;
  }
}
