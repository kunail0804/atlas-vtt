import { Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { SharedAnnotations, SharedPin } from '../../../src/app/online/protocol/mapLayers.ts';
import { DrawingLayer } from '../../../src/app/pixi/drawingLayer.ts';
import { createTextElementView } from '../../../src/app/pixi/textElementView.ts';
import { PIN_ICON_PATHS, resolvePinIcon } from '../../../src/app/types/pinIcons.ts';
import type { DrawingStroke, TextElement } from '../../../src/app/types.ts';

const PIN_RADIUS = 18;

/** Drawings as the plugin's layer takes them: the inverse of `sharedDrawing` in mapLayerInputs.ts. */
function strokes(annotations: SharedAnnotations): Record<string, DrawingStroke> {
  const result: Record<string, DrawingStroke> = {};
  annotations.drawings.forEach((drawing, index) => {
    const points: { x: number; y: number }[] = [];
    for (let at = 0; at + 1 < drawing.points.length; at += 2) points.push({ x: drawing.points[at] ?? 0, y: drawing.points[at + 1] ?? 0 });
    const id = `shared-${index}`;
    result[id] = {
      id, kind: 'drawing', timestamp: index, type: drawing.type, points, color: drawing.colour, width: drawing.width, opacity: drawing.opacity,
      ...(drawing.icon === undefined ? {} : { icon: drawing.icon }),
    };
  });
  return result;
}

/** A text as the plugin's view takes it: the inverse of `sharedText`. */
function textElement(text: SharedAnnotations['texts'][number], index: number): TextElement {
  return {
    id: `shared-text-${index}`, kind: 'text', x: text.x, y: text.y, text: text.text, fontSize: text.fontSize, fontFamily: text.fontFamily, color: text.colour,
    ...(text.background === null ? {} : { backgroundColor: text.background }),
    padding: text.padding, borderRadius: text.radius, opacity: text.opacity, align: text.align, bold: text.bold, italic: text.italic, rotation: text.rotation, scale: text.scale,
  };
}

/**
 * The map's drawings and texts, drawn by the plugin's own layer and text view, and the pins the GM
 * made readable. A pin the player opens is found: the GM's log then says who found it and shows its note.
 */
export class AnnotationsView {
  private readonly drawings: DrawingLayer;
  private readonly texts: Container;
  private readonly pins: Container;
  private readonly send: (message: PlayerMessage) => void;
  private readonly scene: () => string | null;
  private readonly opened: () => void;

  constructor(annotations: Container, pins: Container, send: (message: PlayerMessage) => void, scene: () => string | null, opened: () => void) {
    const drawingContainer = new Container();
    this.texts = new Container();
    annotations.addChild(drawingContainer, this.texts);
    this.drawings = new DrawingLayer(drawingContainer);
    this.pins = pins;
    this.send = send;
    this.scene = scene;
    this.opened = opened;
  }

  showAnnotations(annotations: SharedAnnotations): void {
    this.drawings.sync(strokes(annotations));
    for (const child of [...this.texts.children]) child.destroy({ children: true });
    annotations.texts.forEach((text, index) => this.texts.addChild(createTextElementView(textElement(text, index))));
  }

  showPins(pins: readonly SharedPin[]): void {
    for (const child of [...this.pins.children]) child.destroy({ children: true });
    for (const pin of pins) this.pins.addChild(this.pin(pin));
  }

  clear(): void {
    this.drawings.sync({});
    this.showPins([]);
    for (const child of [...this.texts.children]) child.destroy({ children: true });
  }

  private pin(pin: SharedPin): Container {
    const node = new Container();
    node.position.set(pin.x, pin.y);
    node.eventMode = 'static';
    node.cursor = 'pointer';
    node.addChild(new Graphics().circle(0, 0, PIN_RADIUS).fill({ color: pin.found === null ? 0x6b78ff : 0x3a3f4b }).stroke({ color: 0xffffff, width: 2 }));
    const icon = resolvePinIcon(pin.icon);
    const path = (PIN_ICON_PATHS as Record<string, string>)[icon];
    if (pin.label !== undefined) {
      const label = new Text({ text: pin.label, style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fontWeight: '700', fill: 0xffffff } });
      label.anchor.set(0.5);
      node.addChild(label);
    } else if (path !== undefined) {
      const glyph = new Graphics().svg(`<svg viewBox="0 0 512 512"><path d="${path}" fill="#ffffff"/></svg>`);
      const size = PIN_RADIUS * 1.2;
      glyph.scale.set(size / 512);
      glyph.position.set(-size / 2, -size / 2);
      node.addChild(glyph);
    }
    node.on('pointertap', (event: FederatedPointerEvent) => {
      if (event.button !== 0) return;
      const scene = this.scene();
      if (scene === null) return;
      this.send({ t: 'pin-found', scene, pin: pin.id });
      this.opened();
    });
    return node;
  }
}
