import { Container, Graphics } from 'pixi.js';
import type { SensedMark, SharedDoor } from '../../../src/app/online/protocol/mapLayers.ts';
import { DOOR_GLYPH_PATHS } from '../../../src/app/lighting/doorGlyphs.ts';
import { LIGHTING_Z_INDEX } from '../../../src/app/pixi/lighting/LightingRenderer.ts';
import { SensedOutlines } from '../../../src/app/pixi/token-renderer/SensedOutlines.ts';

const BADGE_RADIUS = 14;

/**
 * What a lit scene shows the players above its lighting: the badges of the doors they see now, and
 * the tokens they only sense, as the plugin's own outlines. Both are sent for lit scenes only.
 */
export class LitMarks {
  private readonly doors = new Container({ label: 'playerDoorBadges' });
  private readonly sensed = new SensedOutlines();

  constructor(parent: Container) {
    this.doors.zIndex = LIGHTING_Z_INDEX + 2;
    this.doors.eventMode = 'none';
    this.sensed.view.visible = true;
    parent.addChild(this.doors, this.sensed.view);
  }

  showDoors(doors: readonly SharedDoor[]): void {
    for (const child of [...this.doors.children]) child.destroy();
    for (const door of doors) {
      const [x1, y1, x2, y2] = door.p;
      const badge = new Graphics().circle(0, 0, BADGE_RADIUS).fill({ color: 0x26272d }).stroke({ color: 0xffffff, width: 1.5 });
      const size = BADGE_RADIUS * 1.3;
      const glyph = new Graphics().svg(`<svg viewBox="0 0 512 512"><path d="${DOOR_GLYPH_PATHS[door.open ? 'open' : 'closed']}" fill="#ffffff"/></svg>`);
      glyph.scale.set(size / 512);
      glyph.position.set(-size / 2, -size / 2);
      const node = new Container();
      node.position.set((x1 + x2) / 2, (y1 + y2) / 2);
      node.addChild(badge, glyph);
      this.doors.addChild(node);
    }
  }

  showSensed(marks: readonly SensedMark[]): void {
    this.sensed.sync(marks.map((mark, index) => ({ id: `sensed-${index}`, x: mark.x, y: mark.y, size: mark.size })));
  }

  clear(): void {
    this.showDoors([]);
    this.showSensed([]);
  }
}
