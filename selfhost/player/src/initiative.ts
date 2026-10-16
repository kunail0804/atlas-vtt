import type { SharedCombatant, SharedInitiative, SharedSide } from '../../../src/app/online/protocol/initiative.ts';
import type { AssetLoader } from './assets.ts';

const PORTRAIT_SIDE = 256;
const SIDE_NAMES: Readonly<Record<SharedSide, string>> = { players: 'Joueurs', opponents: 'Adversaires' };

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/**
 * The players' initiative list, as the GM's player window shows it: in the GM's order, the one whose
 * turn it is marked and kept in view, grouped by side when the fight goes by sides. Hidden
 * combatants never reach it; names show only where the GM's player view shows them.
 */
export class InitiativePanel {
  private readonly panel: HTMLElement;
  private readonly assets: AssetLoader;
  private readonly portraits = new Map<string, string>();
  private list: SharedInitiative | null = null;

  constructor(host: HTMLElement, assets: AssetLoader) {
    this.assets = assets;
    this.panel = node('aside', 'initiative');
    this.panel.setAttribute('aria-label', 'Initiative');
    this.panel.hidden = true;
    host.append(this.panel);
  }

  show(list: SharedInitiative | null): void {
    this.list = list;
    this.render();
  }

  private render(): void {
    const list = this.list;
    this.panel.replaceChildren();
    if (list === null || list.combatants.length === 0) {
      this.panel.hidden = true;
      return;
    }
    this.panel.hidden = false;
    this.panel.append(node('h2', 'initiative-title', list.isActive ? `Initiative · round ${list.round}` : 'Initiative'));
    const rows = node('ol', 'initiative-list');
    if (list.bySides) {
      const order: SharedSide[] = list.firstSide === 'players' ? ['players', 'opponents'] : ['opponents', 'players'];
      for (const side of order) {
        const members = list.combatants.filter((combatant) => combatant.side === side);
        if (members.length === 0) continue;
        const heading = node('li', 'initiative-side', SIDE_NAMES[side]);
        if (list.activeSide === side) heading.dataset.turn = 'true';
        rows.append(heading);
        for (const combatant of members) rows.append(this.row(combatant, false));
      }
    } else {
      for (const combatant of list.combatants) rows.append(this.row(combatant, true));
    }
    this.panel.append(rows);
    // The turn stays in view: the list scrolls by itself, never the page around it.
    const turn = rows.querySelector<HTMLElement>('[data-turn="true"]');
    if (turn !== null) rows.scrollTop = Math.max(0, turn.offsetTop - rows.clientHeight / 2);
  }

  private row(combatant: SharedCombatant, withNumber: boolean): HTMLElement {
    const row = node('li', 'combatant');
    if (combatant.turn) row.dataset.turn = 'true';
    if (combatant.sitsOut) row.dataset.out = 'true';
    const face = node('span', 'combatant-face');
    if (combatant.ring !== null) face.style.borderColor = combatant.ring.colour ?? 'transparent';
    if (combatant.art !== null) {
      const hash = combatant.art.hash;
      const known = this.portraits.get(hash);
      if (known !== undefined) {
        const picture = node('img', 'combatant-art');
        picture.alt = '';
        picture.src = known;
        face.append(picture);
      } else {
        this.assets.image(combatant.art, PORTRAIT_SIDE).then((loaded) => {
          this.portraits.set(hash, loaded.url);
          this.render();
        }).catch(() => undefined);
      }
    }
    const text = node('span', 'combatant-text');
    text.append(node('span', 'combatant-name', combatant.name ?? '?'));
    if (combatant.sitsOut) text.append(node('span', 'combatant-note', 'passe ce round'));
    if (combatant.hp !== null && combatant.hp.max > 0) {
      const bar = node('span', 'combatant-hp');
      const fill = node('span', 'combatant-hp-fill');
      fill.style.width = `${Math.max(0, Math.min(100, (combatant.hp.current / combatant.hp.max) * 100))}%`;
      bar.append(fill);
      bar.setAttribute('aria-label', `${combatant.hp.current} / ${combatant.hp.max} PV`);
      text.append(bar);
    }
    row.append(face, text);
    if (withNumber) row.append(node('span', 'combatant-number', String(combatant.initiative)));
    return row;
  }
}
