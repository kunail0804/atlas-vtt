import { setIcon } from 'obsidian';
import type { CampaignPick } from './campaignPicker.ts';
import { openMenuBelow, type MenuEntry } from './dockMenu.ts';
import { t } from '../../../i18n';

/** A world the running table can play, as its menu lists it. */
export interface WorldChoice {
  readonly id: string;
  readonly name: string;
}

/** The world a running table plays, and the worlds it can play instead. */
export interface WorldRow {
  /** The world played, or null for none. */
  readonly chosen: string | null;
  /** The world's name; null while it plays none, or its world is not read yet. */
  readonly name: string | null;
  /** Every world, the most recently played first; empty while the worlds are not read yet. */
  readonly choices: readonly WorldChoice[];
}

export interface WorldRowActions {
  /** The running table plays the world `campaignId` from now on, or none (null). */
  chooseWorld(campaignId: string | null): void;
}

/** The world row of a table that plays `campaignId` (null: none), with the worlds of `campaigns`. */
export function worldRowOf(campaignId: string | null, campaigns: CampaignPick): WorldRow {
  const choices = (campaigns.list ?? []).map(({ id, name }) => ({ id, name }));
  return { chosen: campaignId, name: choices.find((choice) => choice.id === campaignId)?.name ?? null, choices };
}

/** No world, then every world, the one played ticked. */
export function worldEntries(row: WorldRow, actions: WorldRowActions): MenuEntry[] {
  return [
    { title: t('online.noWorld'), checked: row.chosen === null, run: () => actions.chooseWorld(null) },
    ...row.choices.map((choice, index): MenuEntry => ({ title: choice.name, checked: choice.id === row.chosen, apart: index === 0, run: () => actions.chooseWorld(choice.id) })),
  ];
}

/**
 * The row under a running table's header that says which world it plays, in the invite row's look:
 * a press opens the worlds and No world, and the one chosen is played at once, players staying seated.
 */
export function renderWorldRow(layer: HTMLElement, row: WorldRow, actions: WorldRowActions): HTMLButtonElement {
  const button = layer.createEl('button', {
    cls: 'atlas-online-invite atlas-online-world',
    attr: { type: 'button', 'aria-haspopup': 'menu', 'aria-label': t('online.chooseWorld'), 'data-focus-key': 'world' },
  });
  setIcon(button.createSpan({ cls: 'atlas-online-invite__icon', attr: { 'aria-hidden': 'true' } }), 'globe');
  button.createEl('bdi', { text: row.chosen === null || row.name === null ? t('online.noWorld') : t('online.worldNamed', { name: row.name }) });
  button.addEventListener('click', () => openMenuBelow(worldEntries(row, actions), button));
  return button;
}
