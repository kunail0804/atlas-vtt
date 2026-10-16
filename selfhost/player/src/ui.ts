import { CLOSE, JOIN_CODE_PATTERN, playerName } from '../../../src/app/online/protocol/relay.ts';
import type { JoinRequest } from './connection.ts';

const NAME_KEY = 'atlas-vtt:name';

/** Why the relay closed, in the player's words. */
const CLOSE_TEXT: Readonly<Record<number, string>> = {
  [CLOSE.wrongCode]: 'Code incorrect. Vérifie le code que le MJ t\'a donné.',
  [CLOSE.paused]: 'Trop de codes faux ont été tentés : les arrivées sont en pause pour quelques minutes.',
  [CLOSE.declined]: 'Le MJ a refusé ton entrée.',
  [CLOSE.noAnswer]: 'Le MJ n\'a pas répondu à temps. Tu peux réessayer.',
  [CLOSE.tooManyKnocks]: 'Trop de personnes attendent déjà. Réessaie dans un moment.',
  [CLOSE.full]: 'La table est pleine.',
  [CLOSE.kicked]: 'Le MJ t\'a retiré de la table.',
  [CLOSE.ended]: 'Cette table est terminée. Demande un nouveau lien au MJ.',
  [CLOSE.superseded]: 'Cette table est terminée. Demande un nouveau lien au MJ.',
  [CLOSE.replaced]: 'Cette table est ouverte dans un autre onglet.',
  [CLOSE.version]: 'Cette page n\'est plus à jour : recharge-la.',
  [CLOSE.rateLimited]: 'Trop de messages envoyés d\'un coup.',
  [CLOSE.protocol]: 'Erreur de communication avec la table.',
};

export function closeText(code: number): string {
  return CLOSE_TEXT[code] ?? 'Connexion perdue.';
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The join screen: a name, and the join code when the GM gave one. Resolves once the player sends it. */
export function askToJoin(host: HTMLElement, error: string | null): Promise<JoinRequest> {
  return new Promise((resolve) => {
    const form = element('form', 'join');
    form.append(element('h1', 'join-title', 'Rejoindre la table'));
    if (error !== null) form.append(element('p', 'join-error', error));
    const nameLabel = element('label', 'join-label', 'Ton nom');
    const name = element('input', 'join-input');
    name.maxLength = 32;
    name.required = true;
    name.setAttribute('autocomplete', 'nickname');
    name.value = window.localStorage.getItem(NAME_KEY) ?? '';
    nameLabel.append(name);
    const codeLabel = element('label', 'join-label', 'Code à 6 chiffres (si le MJ t\'en a donné un)');
    const code = element('input', 'join-input');
    code.inputMode = 'numeric';
    code.maxLength = 7;
    code.placeholder = '000 000';
    codeLabel.append(code);
    const problem = element('p', 'join-error');
    const button = element('button', 'join-button', 'Entrer');
    button.type = 'submit';
    form.append(nameLabel, codeLabel, problem, button);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const shown = playerName(name.value);
      const digits = code.value.replace(/\s/g, '');
      if (shown === null) {
        problem.textContent = 'Choisis un nom (32 caractères au plus).';
        return;
      }
      if (digits !== '' && !JOIN_CODE_PATTERN.test(digits)) {
        problem.textContent = 'Le code fait 6 chiffres.';
        return;
      }
      window.localStorage.setItem(NAME_KEY, shown);
      form.remove();
      resolve({ name: shown, code: digits === '' ? null : digits });
    });
    host.append(form);
    name.focus();
  });
}

/** The line at the top of the screen that says how the table is. */
export class StatusLine {
  private readonly node: HTMLElement;

  constructor(host: HTMLElement) {
    this.node = element('div', 'status');
    host.append(this.node);
  }

  show(text: string | null, tone: 'info' | 'warn' = 'info'): void {
    this.node.textContent = text ?? '';
    this.node.hidden = text === null;
    this.node.dataset.tone = tone;
  }
}

export type ToolName = 'move' | 'laser' | 'measure';

const TOOL_LABELS: ReadonlyArray<[ToolName, string]> = [['move', 'Déplacer'], ['laser', 'Laser'], ['measure', 'Mesurer']];

/** The player's tools: move the map and their tokens, point with the laser, or measure. Escape goes back to moving. */
export function toolbar(host: HTMLElement, choose: (tool: ToolName) => void): void {
  const bar = element('div', 'tools');
  const buttons = new Map<ToolName, HTMLButtonElement>();
  const select = (tool: ToolName): void => {
    for (const [name, button] of buttons) button.setAttribute('aria-pressed', String(name === tool));
    choose(tool);
  };
  for (const [tool, label] of TOOL_LABELS) {
    const button = element('button', 'tool', label);
    button.type = 'button';
    button.addEventListener('click', () => select(tool));
    buttons.set(tool, button);
    bar.append(button);
  }
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) select('move');
  });
  host.append(bar);
  select('move');
}

