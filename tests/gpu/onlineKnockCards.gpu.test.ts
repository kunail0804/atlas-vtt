import '../setup/obsidianDom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import css from '../../styles/main.scss?inline';
import { KNOCK_ROOM, knockCards, renderCards } from '../../src/app/online/gm/dock/knockStack';
import { DASHBOARD_THEME as THEME } from './dashboardTheme';

vi.mock('events', async () => import('eventemitter3'));

/** The cards of players who ask for a seat, at the dock's width, laid out by the plugin's stylesheet. */

const ARMED = { answered: false, full: false, armed: true };
const WAITING = [
  { id: 'a'.repeat(20), name: 'Mira', ...ARMED },
  { id: 'b'.repeat(20), name: 'Ana', reclaim: true, ...ARMED },
  { id: 'c'.repeat(20), name: 'Brannoch the Unbowed', reclaim: true, seatConnected: true, ...ARMED },
];

function stack(waiting: typeof WAITING = WAITING): HTMLElement {
  document.body.className = 'theme-dark';
  const plugin = document.body.createDiv({ cls: 'atlas-vtt-plugin' });
  plugin.style.cssText = 'position: absolute; inset: 0; background: var(--background-primary);';
  const dock = plugin.createDiv({ cls: 'atlas-online-dock' });
  dock.style.cssText = 'left: 40px; bottom: 40px;';
  const cards = dock.createDiv({ cls: 'atlas-online-knocks' });
  cards.style.width = '300px';
  renderCards(cards, knockCards(waiting, { admit: vi.fn(), decline: vi.fn() }), dock);
  return cards;
}

/** Whether `inner` lies wholly inside `outer`, to the pixel. */
function inside(inner: DOMRect, outer: DOMRect): boolean {
  return inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;
}

describe('a newcomer\'s card', () => {
  const style = document.createElement('style');
  style.textContent = THEME + css;
  beforeEach(() => document.head.append(style));
  afterEach(() => {
    style.remove();
    document.body.empty();
  });

  it('shows its whole sentence inside the card, clear of its answers, at the dock\'s width', async () => {
    const cards = stack();
    for (const card of cards.querySelectorAll<HTMLElement>('.atlas-online-knock')) {
      const box = card.getBoundingClientRect();
      const buttons = [...card.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
      for (const part of card.querySelectorAll<HTMLElement>('.atlas-online-knock__rest')) {
        const words = part.getBoundingClientRect();
        expect(inside(words, box), part.textContent ?? '').toBe(true);
        for (const button of buttons) {
          const overlaps = words.left < button.right && words.right > button.left && words.top < button.bottom && words.bottom > button.top;
          expect(overlaps, `${part.textContent} under a button`).toBe(false);
        }
      }
      for (const button of buttons) expect(inside(button, box)).toBe(true);
    }
    await page.screenshot({ path: '__screenshots__/atlas-online-knock-cards.png', element: cards });
  });

  it('keeps a card that wraps within the room the control leaves for one card, and a short one on one line', () => {
    const one = stack([WAITING[2]!]);
    const card = one.querySelector<HTMLElement>('.atlas-online-knock')!;
    expect(card.classList.contains('atlas-online-knock--wrap')).toBe(true);
    // The stack stands a gap (its own padding) over the control.
    const gap = parseFloat(getComputedStyle(one).paddingTop);
    expect(one.getBoundingClientRect().height + gap).toBeLessThanOrEqual(KNOCK_ROOM);
    document.body.empty();
    const short = stack([WAITING[0]!]).querySelector<HTMLElement>('.atlas-online-knock')!;
    expect(short.classList.contains('atlas-online-knock--wrap')).toBe(false);
    const button = short.querySelector('button')!.getBoundingClientRect();
    expect(short.getBoundingClientRect().height).toBe(button.height);
  });
});
