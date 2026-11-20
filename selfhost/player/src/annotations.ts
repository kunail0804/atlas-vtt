import { Container, Graphics, Text, type FederatedPointerEvent } from 'pixi.js';
import { annotationList } from '../../../src/app/annotations/annotationList.ts';
import type { DrawMine } from '../../../src/app/online/protocol/draw.ts';
import type { PlayerMessage } from '../../../src/app/online/protocol/game.ts';
import type { SharedAnnotations } from '../../../src/app/online/protocol/annotations.ts';
import type { SharedPin } from '../../../src/app/online/protocol/mapLayers.ts';
import { ToldAnnotations, type ToldNames } from '../../../src/app/online/marks/toldAnnotations.ts';
import { AnnotationLayer } from '../../../src/app/pixi/annotations/AnnotationLayer.ts';
import { watchTextFonts } from '../../../src/app/pixi/textFonts.ts';
import { PIN_ICON_PATHS, resolvePinIcon } from '../../../src/app/types/pinIcons.ts';

const PIN_RADIUS = 18;
const NONE: SharedAnnotations = { drawings: [], texts: [] };

/** The ids the player names their own drawings and texts by (`draw-mine`), for the Draw tool's requests. */
export interface OwnIds {
  readonly drawings: readonly string[];
  readonly texts: readonly string[];
}

/** The names `mine` gives the entries of the `annotations` message it was told for. */
function namesOf(mine: DrawMine): ToldNames {
  const drawings = new Map(mine.drawings.map((own) => [own.at, own]));
  const texts = new Map(mine.texts.map((own) => [own.at, own.id]));
  return { drawing: (at) => drawings.get(at), text: (at) => texts.get(at) };
}

/**
 * The map's drawings and texts, drawn as the GM's Atlas draws them (`ToldAnnotations` reads them
 * into records, `AnnotationLayer` draws those), and the pins the GM made readable. A pin the player
 * opens is found: the GM's log then says who found it and shows its note.
 */
export class AnnotationsView {
  private readonly layer: AnnotationLayer;
  private readonly told = new ToldAnnotations();
  /** What the GM last sent, and its number (`rev`). */
  private shown: SharedAnnotations = NONE;
  private rev: number | undefined;
  /** Which of them are the player's own, as the GM last said; null until it did for what is shown. */
  private mine: DrawMine | null = null;
  private readonly pins: Container;
  private readonly send: (message: PlayerMessage) => void;
  private readonly scene: () => string | null;
  private readonly opened: (found: string | null) => void;

  constructor(annotations: Container, pins: Container, send: (message: PlayerMessage) => void, scene: () => string | null, opened: (found: string | null) => void) {
    annotations.sortableChildren = true;
    this.layer = new AnnotationLayer(annotations, { zoom: () => annotations.parent?.scale.x ?? 1 });
    // A text is drawn once its face has loaded.
    watchTextFonts(document.fonts, () => {
      this.layer.fontsArrived();
      this.layer.setViews(null, true);
    });
    this.pins = pins;
    this.send = send;
    this.scene = scene;
    this.opened = opened;
  }

  showAnnotations(annotations: SharedAnnotations & { readonly rev?: number }): void {
    this.shown = annotations;
    this.rev = annotations.rev;
    this.render();
  }

  /** The GM said which drawings and texts are the player's own. */
  showMine(mine: DrawMine): void {
    this.mine = mine;
    if (mine.rev === this.rev) this.render();
  }

  /** The player's own drawings and texts, by the ids the GM named them by; none while it has not said. */
  own(): OwnIds {
    const mine = this.mine;
    if (mine === null || mine.rev !== this.rev) return { drawings: [], texts: [] };
    return { drawings: mine.drawings.map((own) => own.id), texts: mine.texts.map((own) => own.id) };
  }

  private render(): void {
    const mine = this.mine !== null && this.mine.rev === this.rev ? this.mine : null;
    const records = this.told.read(this.shown, true, mine === null ? undefined : namesOf(mine));
    this.layer.setList(annotationList(records));
    // The page draws every drawing at once: it shows the whole map, and has few.
    this.layer.setViews(null, true);
  }

  showPins(pins: readonly SharedPin[]): void {
    for (const child of [...this.pins.children]) child.destroy({ children: true });
    for (const pin of pins) this.pins.addChild(this.pin(pin));
  }

  clear(): void {
    this.shown = NONE;
    this.rev = undefined;
    this.mine = null;
    this.told.clear();
    this.layer.setList([]);
    this.showPins([]);
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
      this.opened(pin.found);
    });
    return node;
  }
}
