import { Graphics } from 'pixi.js';
import { drawDashedLine } from './wallKindLook';

export const VERTEX_HANDLE_RADIUS = 4;

/** What the wall editor shows before it is placed: the next wall of a chain, a freehand stroke. */
export class WallPreview {
  readonly graphics = new Graphics();

  /** Live preview state: anchor point + current cursor position */
  private anchor: { x: number; y: number } | null = null;
  private cursor: { x: number; y: number } | null = null;
  /** The preview's cursor end lies on a wall's end. */
  private joined = false;

  /** Freeform drawing preview path */
  private stroke: Array<{ x: number; y: number }> = [];

  /** `accent` is the theme's accent colour, which rings a wall end the chain joins. */
  constructor(private readonly accent: () => number) {}

  /**
   * Set the anchor point for the live wall preview (the last placed vertex).
   * Pass null to clear the preview.
   */
  setAnchor(point: { x: number; y: number } | null): void {
    this.anchor = point;
    this.drawLine();
  }

  /** Update the cursor end of the live preview line. Called on pointermove; `joined` when it lies on a wall's end. */
  moveCursor(x: number, y: number, joined: boolean = false): void {
    this.cursor = { x, y };
    this.joined = joined;
    this.drawLine();
  }

  /** Clear the preview line. */
  clear(): void {
    this.anchor = null;
    this.cursor = null;
    this.joined = false;
    this.graphics.clear();
  }

  /** Start freeform preview path. */
  startStroke(x: number, y: number): void {
    this.stroke = [{ x, y }];
    this.drawStroke();
  }

  /** Add a point to the freeform preview path. */
  addStrokePoint(x: number, y: number): void {
    this.stroke.push({ x, y });
    this.drawStroke();
  }

  /** Clear freeform preview. */
  clearStroke(): void {
    this.stroke = [];
    this.graphics.clear();
  }

  private drawStroke(): void {
    this.graphics.clear();
    if (this.stroke.length < 2) {
      // Single point — just show the anchor dot
      if (this.stroke.length === 1) {
        const p = this.stroke[0]!;
        this.graphics.circle(p.x, p.y, VERTEX_HANDLE_RADIUS + 1);
        this.graphics.fill({ color: 0xffffff, alpha: 0.9 });
      }
      return;
    }

    const g = this.graphics;

    // Draw the path as a continuous line
    g.moveTo(this.stroke[0]!.x, this.stroke[0]!.y);
    for (let i = 1; i < this.stroke.length; i++) {
      g.lineTo(this.stroke[i]!.x, this.stroke[i]!.y);
    }
    g.stroke({ width: 3, color: 0xffffff, alpha: 0.7 });

    // Start point
    const first = this.stroke[0]!;
    g.circle(first.x, first.y, VERTEX_HANDLE_RADIUS + 1);
    g.fill({ color: 0xffffff, alpha: 0.9 });

    // Current point
    const last = this.stroke[this.stroke.length - 1]!;
    g.circle(last.x, last.y, VERTEX_HANDLE_RADIUS);
    g.stroke({ width: 1.5, color: 0xffffff, alpha: 0.7 });
  }

  private drawLine(): void {
    this.graphics.clear();
    if (!this.anchor || !this.cursor) return;

    const g = this.graphics;
    const color = 0xffffff;

    // Anchor point: filled circle
    g.circle(this.anchor.x, this.anchor.y, VERTEX_HANDLE_RADIUS + 1);
    g.fill({ color, alpha: 0.9 });

    // Preview line: dashed to show it's not placed yet
    drawDashedLine(
      g,
      this.anchor.x, this.anchor.y,
      this.cursor.x, this.cursor.y,
      color, 2, 6, 4,
    );

    // Cursor point: hollow circle, ringed where it joins a wall's end
    g.circle(this.cursor.x, this.cursor.y, VERTEX_HANDLE_RADIUS);
    g.stroke({ width: 1.5, color, alpha: 0.7 });
    if (this.joined) {
      g.circle(this.cursor.x, this.cursor.y, VERTEX_HANDLE_RADIUS * 2);
      g.stroke({ width: 2, color: this.accent(), alpha: 0.9 });
    }
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
