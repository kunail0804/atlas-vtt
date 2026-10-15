import { Container, Graphics, Text } from 'pixi.js';
import type { SharedBar, SharedCondition, SharedTokenUI } from '../../../src/app/online/protocol/tokenUI.ts';
import { resourceColor } from '../../../src/app/resources/resourceColors.ts';
import { WIDGET_ICON_PATHS, resolveWidgetIcon } from '../../../src/app/types/widgetIcons.ts';

const TRACK = 0x1b1d22;
const TEXT_STYLE = { fontFamily: 'system-ui, sans-serif', fill: 0xffffff, stroke: { color: 0x000000, width: 3 } } as const;

/** The colour a bar shows in: the plugin's own rule (yellow, then red, as a defeating resource runs low). */
function barColour(bar: SharedBar): string {
  return resourceColor(
    { key: '', name: '', field: '', direction: bar.direction, color: bar.colour, defeatedWhenSpent: bar.defeats, visibleToPlayers: true },
    { current: bar.current, max: bar.max },
  );
}

/** A widget icon as a white glyph `size` world pixels wide, centred on (0, 0). */
export function iconGlyph(icon: string, size: number, colour = 0xffffff): Graphics {
  const path = WIDGET_ICON_PATHS[resolveWidgetIcon(icon)];
  const glyph = new Graphics().svg(`<svg viewBox="0 0 512 512"><path d="${path}" fill="#ffffff"/></svg>`);
  glyph.tint = colour;
  glyph.scale.set(size / 512);
  glyph.position.set(-size / 2, -size / 2);
  return glyph;
}

function drawBars(bars: readonly SharedBar[], width: number, top: number): { node: Container; bottom: number } {
  const node = new Container();
  const height = Math.max(4, width * 0.09);
  let y = top;
  for (const bar of bars) {
    const share = bar.direction === 'static' ? 1 : Math.max(0, Math.min(1, bar.current / bar.max));
    const shape = new Graphics()
      .roundRect(-width / 2, y, width, height, height / 2).fill({ color: TRACK })
      .roundRect(-width / 2, y, width * share, height, height / 2).fill({ color: barColour(bar) });
    node.addChild(shape);
    // A static value (an armour class) is its max, written on a full bar.
    if (bar.direction === 'static') {
      const value = new Text({ text: String(bar.max), style: { ...TEXT_STYLE, fontSize: height * 0.9 } });
      value.anchor.set(0.5);
      value.position.set(0, y + height / 2);
      node.addChild(value);
    }
    y += height + 2;
  }
  return { node, bottom: y };
}

function drawCondition(condition: SharedCondition, size: number): Container {
  const badge = new Container();
  badge.addChild(new Graphics().circle(0, 0, size / 2).fill({ color: condition.colour }).stroke({ color: 0x000000, width: Math.max(1, size * 0.08) }));
  if (condition.glyph.kind === 'icon') badge.addChild(iconGlyph(condition.glyph.icon, size * 0.62));
  else {
    const text = new Text({ text: condition.glyph.text, style: { ...TEXT_STYLE, fontSize: size * 0.5, stroke: { color: 0x000000, width: 2 } } });
    text.anchor.set(0.5);
    badge.addChild(text);
  }
  if (condition.value !== null) {
    const pip = new Text({ text: String(condition.value), style: { ...TEXT_STYLE, fontSize: size * 0.42 } });
    pip.anchor.set(0.5);
    pip.position.set(size * 0.38, size * 0.38);
    badge.addChild(pip);
  }
  return badge;
}

/**
 * What the GM's player window draws around a creature token: bars below it, condition badges on
 * the top of its ring, its nameplate, and a skull while it is downed. Returns where the name goes.
 */
export function drawTokenUI(group: Container, ui: SharedTokenUI, size: number, outer: number): { nameTop: number } {
  const { node: bars, bottom } = drawBars(ui.bars, size, outer / 2 + 3);
  group.addChild(bars);
  const badge = Math.max(10, size * 0.24);
  ui.conditions.forEach((condition, index) => {
    // Spread along the top of the ring, centred, as the badges sit on Atlas's own tokens.
    const step = Math.min(28, 160 / Math.max(1, ui.conditions.length));
    const angle = ((-90 + (index - (ui.conditions.length - 1) / 2) * step) * Math.PI) / 180;
    const node = drawCondition(condition, badge);
    node.position.set(Math.cos(angle) * (outer / 2), Math.sin(angle) * (outer / 2));
    group.addChild(node);
  });
  if (ui.downed) {
    const skull = iconGlyph('skull', size * 0.5, 0xf2f2f2);
    skull.alpha = 0.9;
    group.addChild(skull);
  }
  return { nameTop: bottom + 2 };
}
