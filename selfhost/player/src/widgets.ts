import { nextTimerStep, timerSecondsAt, type SharedWidget, type SharedWidgetBar } from '../../../src/app/online/protocol/widgets.ts';
import { WIDGET_ICON_PATHS, resolveWidgetIcon } from '../../../src/app/types/widgetIcons.ts';
import { CLOCK_VIEW_SIZE, DEFAULT_CLOCK_COLOR, clockFace } from '../../../src/app/utils/clockWidget.ts';

const SVG = 'http://www.w3.org/2000/svg';
const DEFAULT_COLOUR = '#7c8cff';

function svg(viewBox: string, size: number): SVGSVGElement {
  const root = document.createElementNS(SVG, 'svg');
  root.setAttribute('viewBox', viewBox);
  root.setAttribute('width', String(size));
  root.setAttribute('height', String(size));
  root.setAttribute('aria-hidden', 'true');
  return root;
}

function path(d: string, fill: string, opacity = 1): SVGPathElement {
  const shape = document.createElementNS(SVG, 'path');
  shape.setAttribute('d', d);
  shape.setAttribute('fill', fill);
  if (opacity !== 1) shape.setAttribute('fill-opacity', String(opacity));
  return shape;
}

const minutes = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/**
 * The players' widget bar, as the GM's player window shows it: counters, clocks with the plugin's
 * own wedges, and timers. A running timer counts down on this page by the plugin's rule
 * (`timerSecondsAt`), a moment behind the GM's, so a pause never shows a second the GM's did not.
 */
export class WidgetBar {
  private readonly bar: HTMLElement;
  private timers: { node: HTMLElement; value: number; endsAt: number }[] = [];
  private tick: number | undefined;

  constructor(host: HTMLElement) {
    this.bar = document.createElement('div');
    this.bar.className = 'widgets';
    this.bar.hidden = true;
    host.append(this.bar);
  }

  show(bar: SharedWidgetBar | null): void {
    window.clearTimeout(this.tick);
    this.timers = [];
    this.bar.replaceChildren();
    if (bar === null || bar.widgets.length === 0) {
      this.bar.hidden = true;
      return;
    }
    this.bar.hidden = false;
    this.bar.style.setProperty('--widget-scale', String(bar.scale));
    const received = performance.now();
    for (const widget of bar.widgets) this.bar.append(this.widget(widget, received));
    this.step();
  }

  private widget(widget: SharedWidget, received: number): HTMLElement {
    const node = document.createElement('div');
    node.className = 'widget';
    node.dataset.kind = widget.kind;
    const colour = widget.colour ?? (widget.kind === 'clock' ? DEFAULT_CLOCK_COLOR : DEFAULT_COLOUR);
    const label = document.createElement('span');
    label.className = 'widget-label';
    label.textContent = widget.label;
    const value = document.createElement('span');
    value.className = 'widget-value';
    if (widget.kind === 'clock') {
      const segments = widget.segments ?? 4;
      const face = clockFace(segments, widget.value, widget.showCount === true);
      const clock = svg(`0 0 ${CLOCK_VIEW_SIZE} ${CLOCK_VIEW_SIZE}`, 30);
      face.wedges.forEach((d, index) => {
        const wedge = path(d, colour, index < widget.value ? 1 : 0.18);
        wedge.setAttribute('stroke', '#101114');
        wedge.setAttribute('stroke-width', '0.8');
        clock.append(wedge);
      });
      if (face.count !== null) {
        const count = document.createElementNS(SVG, 'text');
        count.setAttribute('x', String(CLOCK_VIEW_SIZE / 2));
        count.setAttribute('y', String(CLOCK_VIEW_SIZE / 2));
        count.setAttribute('text-anchor', 'middle');
        count.setAttribute('dominant-baseline', 'central');
        count.setAttribute('font-size', String(face.count.fontSize));
        count.setAttribute('fill', '#ffffff');
        count.textContent = face.count.text;
        clock.append(count);
      }
      value.append(clock);
      value.setAttribute('aria-label', `${widget.value} sur ${segments}`);
    } else {
      const icon = svg('0 0 512 512', 18);
      icon.append(path(WIDGET_ICON_PATHS[resolveWidgetIcon(widget.icon)], colour));
      node.append(icon);
      if (widget.kind === 'counter') value.textContent = String(widget.value);
      else if (widget.since === undefined) value.textContent = minutes(widget.value);
      else this.timers.push({ node: value, value: widget.value, endsAt: received + widget.value * 1000 - widget.since });
    }
    node.append(label, value);
    return node;
  }

  /** Redraws the running timers and waits for the next second any of them shows. */
  private step(): void {
    const now = performance.now();
    let next: number | null = null;
    for (const timer of this.timers) {
      const left = timer.endsAt - now;
      timer.node.textContent = minutes(timerSecondsAt(timer.value, left));
      const step = nextTimerStep(timer.value, left);
      if (step !== null) next = next === null ? step : Math.min(next, step);
    }
    if (next !== null) this.tick = window.setTimeout(() => this.step(), next);
  }
}
