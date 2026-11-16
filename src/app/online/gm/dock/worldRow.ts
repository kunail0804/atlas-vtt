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
  /** The worlds are read: until then a chosen world has no name yet, and the row shows `WORLD_LOADING`. */
  readonly read: boolean;
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
  return { chosen: campaignId, name: choices.find((choice) => choice.id === campaignId)?.name ?? null, read: campaigns.list !== null, choices };
}

/** What the row shows of a chosen world while the worlds are not read yet. */
export const WORLD_LOADING = '…';

/** What the row says: the world played, `WORLD_LOADING` while its name is not read yet, else No world. */
export function worldRowText(row: WorldRow): string {
  if (row.chosen === null) return t('online.noWorld');
  if (row.name !== null) return t('online.worldNamed', { name: row.name });
  return row.read ? t('online.noWorld') : WORLD_LOADING;
}

/**
 * No world, then every world, the one played ticked. While the worlds are not read yet, a single
 * switched-off row says so: No world alone would take the world off the table.
 */
export function worldEntries(row: WorldRow, actions: WorldRowActions): MenuEntry[] {
  if (!row.read) return [{ title: t('online.readingCampaigns'), disabled: true, run: () => undefined }];
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
  button.createEl('bdi', { text: worldRowText(row) });
  button.addEventListener('click', () => openMenuBelow(worldEntries(row, actions), button));
  return button;
}
