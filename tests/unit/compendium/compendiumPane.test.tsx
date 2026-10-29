import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer, TFile } from 'obsidian';
import { parse } from 'yaml';
import type { StoredCampaign } from '../../../src/app/campaigns/campaignTypes';
import { CompendiumService } from '../../../src/app/compendium/CompendiumService';
import { CompendiumPane } from '../../../src/app/packages/components/asset-manager/compendium/CompendiumPane';
import { createInMemoryApp, type InMemoryApp } from '../../mocks/inMemoryVault';
import { memoryCampaigns } from '../../mocks/memoryCampaigns';
import { at, ID, zipped } from './sourceZips';

const storage = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../../../src/app/campaigns/CampaignFiles', () => ({ CampaignFiles: { forApp: () => storage.current } }));
const dialogs = vi.hoisted(() => ({ confirmAction: vi.fn() }));
vi.mock('../../../src/app/ui/confirmDialog', () => ({ confirmAction: dialogs.confirmAction }));

const NOTES = {
  [at('Spells/Fireball.md')]: '---\natlas-compendium: spell\nname: Fireball\nlevel: 3\nritual: false\n---\nA bright streak.\n',
  [at('Monsters/Goblin.md')]: '---\natlas-compendium: monster\nname: Goblin\n---\nSmall and green.\n',
  [at('Attribution.md')]: '---\nname: SRD 5.1 attribution\n---\nCC BY 4.0\n',
};

let vault: InMemoryApp;
let campaigns: ReturnType<typeof memoryCampaigns>;

/** The vault's notes with their frontmatter, as Obsidian's metadata cache reads them. */
function readFrontmatter(app: InMemoryApp): void {
  vi.mocked(app.app.metadataCache.getFileCache).mockImplementation((file: TFile) => {
    const text = app.files.get(file.path);
    const match = text === undefined ? null : /^---\n([\s\S]*?)\n---/.exec(text);
    return match ? { frontmatter: parse(match[1] ?? '') as Record<string, unknown> } : null;
  });
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vault = createInMemoryApp();
  readFrontmatter(vault);
  await CompendiumService.forApp(vault.app).installFile({ arrayBuffer: async () => zipped(1, NOTES) });
  const stored: StoredCampaign[] = [
    { id: 'c-1', name: 'Witherwild', createdAt: 1, sources: [ID] },
    { id: 'c-2', name: 'Empty', createdAt: 2, lastPlayed: 5 },
  ];
  campaigns = memoryCampaigns(stored);
  storage.current = campaigns;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  dialogs.confirmAction.mockReset();
});

function renderPane(): { onClose: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn();
  render(<CompendiumPane app={vault.app} tabs={null} onClose={onClose} onDialogChange={() => undefined} />);
  return { onClose };
}

const list = (): HTMLElement => screen.getByRole('listbox', { name: 'Compendium' });
const rows = (): string[] => within(list()).queryAllByRole('option').map((row) => row.querySelector('.atlas-compendium-list__name')?.textContent ?? '');
const row = (name: RegExp): HTMLElement => within(list()).getByRole('option', { name });

describe('the compendium in the asset manager', () => {
  it('shows the books of the campaign this device plays, and every installed book on request', async () => {
    vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
    renderPane();
    expect((screen.getByRole('combobox', { name: 'Campaign' }) as HTMLSelectElement).value).toBe('c-1');
    await waitFor(() => expect(rows()).toEqual(['Fireball', 'Goblin', 'SRD 5.1 attribution']));

    fireEvent.change(screen.getByRole('combobox', { name: 'Campaign' }), { target: { value: 'c-2' } });
    expect(rows()).toEqual([]);
    expect(screen.getByText(/This campaign uses no compendium source yet/)).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Campaign' }), { target: { value: '' } });
    expect(rows()).toEqual(['Fireball', 'Goblin', 'SRD 5.1 attribution']);
  });

  it('opens on the most recently played campaign when this device plays none', async () => {
    renderPane();
    // memoryCampaigns lists Empty first: it was played last.
    expect((screen.getByRole('combobox', { name: 'Campaign' }) as HTMLSelectElement).value).toBe('c-2');
  });

  it('filters by kind and name, and reads the selected entry beside the list', async () => {
    vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
    renderPane();
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.click(screen.getByRole('button', { name: /^Monsters/ }));
    expect(rows()).toEqual(['Goblin']);
    fireEvent.click(screen.getByRole('button', { name: /^All kinds/ }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the compendium' }), { target: { value: 'fire' } });
    expect(rows()).toEqual(['Fireball']);

    fireEvent.click(row(/Fireball/));
    expect(screen.getByText(at('Spells/Fireball.md'))).toBeTruthy();
    // A spell is drawn as a statblock card: its properties, then its text.
    await waitFor(() => {
      const card = document.querySelector('.atlas-compendium-preview__body')?.textContent ?? '';
      expect(card).toContain('Level');
      expect(card).toContain('A bright streak.');
    });
  });

  it('opens an entry in a new tab and closes the manager', async () => {
    vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
    const openFile = vi.fn(async () => undefined);
    vault.app.workspace.getLeaf = vi.fn(() => ({ openFile })) as never;
    const { onClose } = renderPane();
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.doubleClick(row(/Goblin/));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(vault.app.workspace.getLeaf).toHaveBeenCalledWith('tab');
    expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: at('Monsters/Goblin.md') }));
  });

  it('moves an entry to the trash once the GM confirms', async () => {
    vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
    renderPane();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(row(/Goblin/));

    dialogs.confirmAction.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(dialogs.confirmAction).toHaveBeenCalledTimes(1));
    expect(vault.files.has(at('Monsters/Goblin.md'))).toBe(true);

    dialogs.confirmAction.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(vault.files.has(at('Monsters/Goblin.md'))).toBe(false));
    act(() => vault.emit('delete', new TFile(at('Monsters/Goblin.md'))));
    await waitFor(() => expect(rows()).toEqual(['Fireball', 'SRD 5.1 attribution']));
  });

  it('makes a book of the GM\'s own, adds it to the campaign, then makes an entry in it', async () => {
    vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
    renderPane();
    await waitFor(() => expect(rows()).toHaveLength(3));

    fireEvent.click(screen.getByRole('button', { name: 'New book…' }));
    const bookDialog = await screen.findByRole('dialog', { name: 'New book' });
    expect((within(bookDialog).getByLabelText('Game system') as HTMLSelectElement).value).toBe('D&D 5e 2014');
    fireEvent.change(within(bookDialog).getByLabelText('Name of the book'), { target: { value: 'Homebrew' } });
    fireEvent.click(within(bookDialog).getByRole('button', { name: 'Save' }));
    // The campaign got its Personal book on the fly when the tab showed it.
    await waitFor(() => expect(campaigns.current().find((campaign) => campaign.id === 'c-1')?.sources).toEqual([ID, 'dnd5e-2014/personal', 'dnd5e-2014/homebrew']));
    expect(vault.files.has('atlas-vtt/compendium/dnd5e-2014__personal.json')).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Homebrew/ }).getAttribute('aria-pressed')).toBe('true'));
    expect(rows()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'New entry…' }));
    const entryDialog = await screen.findByRole('dialog', { name: 'New compendium entry' });
    expect((within(entryDialog).getByLabelText('Book') as HTMLSelectElement).value).toBe('dnd5e-2014/homebrew');
    expect(within(entryDialog).getByText(/A monster of this game system is a statblock/)).toBeTruthy();
    fireEvent.change(within(entryDialog).getByLabelText('Kind'), { target: { value: 'spell' } });
    fireEvent.change(within(entryDialog).getByLabelText('Name'), { target: { value: 'Ash Bolt' } });
    fireEvent.click(within(entryDialog).getByRole('button', { name: 'Save' }));
    const path = 'Compendium/D&D 5e 2014/Homebrew/Spells/Ash Bolt.md';
    await waitFor(() => expect(vault.files.has(path)).toBe(true));
    act(() => vault.emit('create', new TFile(path)));
    await waitFor(() => expect(rows()).toEqual(['Ash Bolt']));
    expect(row(/Ash Bolt/).getAttribute('aria-selected')).toBe('true');
  });
});

it('adds a new book to a campaign that already lists its id only once', async () => {
  campaigns.update('c-1', (entry) => ({ ...entry, sources: [ID, 'dnd5e-2014/homebrew'] }));
  vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
  renderPane();
  await waitFor(() => expect(rows()).toHaveLength(3));
  const missing = screen.getByRole('region', { name: 'Not in this vault' });
  expect(within(missing).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['dnd5e-2014/homebrew']);

  fireEvent.click(screen.getByRole('button', { name: 'New book…' }));
  const bookDialog = await screen.findByRole('dialog', { name: 'New book' });
  fireEvent.change(within(bookDialog).getByLabelText('Name of the book'), { target: { value: 'Homebrew' } });
  fireEvent.click(within(bookDialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Not in this vault' })).toBeNull());
  await waitFor(() => expect(campaigns.current().find((campaign) => campaign.id === 'c-1')?.sources).toEqual([ID, 'dnd5e-2014/homebrew', 'dnd5e-2014/personal']));
});

it('removes a book from the vault once the GM confirms, and from the campaign shown', async () => {
  vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
  renderPane();
  await waitFor(() => expect(rows()).toHaveLength(3));
  dialogs.confirmAction.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remove SRD 5.1 from the vault' }));
  await waitFor(() => expect(vault.files.has(at('Spells/Fireball.md'))).toBe(false));
  await waitFor(() => expect(campaigns.current().find((campaign) => campaign.id === 'c-1')?.sources ?? []).not.toContain(ID));
  // The Personal book stays, and offers neither removal nor export.
  expect(screen.queryByRole('button', { name: 'Remove Personal from the vault' })).toBeNull();
});

it('offers the campaign\'s personal book first for a new entry', async () => {
  const id = await CompendiumService.forApp(vault.app).ensurePersonalBook({ id: 'dnd5e-2014', name: 'D&D 5e 2014' }, { id: 'personal', name: 'Personal' });
  campaigns.update('c-1', (entry) => ({ ...entry, sources: [ID, id] }));
  vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
  renderPane();
  await waitFor(() => expect(rows()).toHaveLength(3));
  fireEvent.click(screen.getByRole('button', { name: 'New entry…' }));
  const entryDialog = await screen.findByRole('dialog', { name: 'New compendium entry' });
  expect((within(entryDialog).getByLabelText('Book') as HTMLSelectElement).value).toBe('dnd5e-2014/personal');
});

it('hands a table in an entry\'s text to Obsidian\'s Markdown renderer whole, lines and all', async () => {
  const table = '## The Wizard table\n\n| Level | Features |\n| --- | --- |\n| 1 | Spellcasting |';
  vault.files.set(at('Classes/Wizard.md'), `---\natlas-compendium: class\nname: Wizard\nhit-die: d6\n---\n${table}\n`);
  const render = vi.spyOn(MarkdownRenderer, 'render');
  vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
  renderPane();
  act(() => vault.emit('create', new TFile(at('Classes/Wizard.md'))));
  await waitFor(() => expect(rows()).toContain('Wizard'));
  fireEvent.click(row(/Wizard/));
  await waitFor(() => expect(render.mock.calls.some(([, markdown]) => markdown === table)).toBe(true));
});

it('shares a batch of entries with a player the GM made, changes it for one, and removing the player ends it', async () => {
  vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
  renderPane();
  await waitFor(() => expect(rows()).toHaveLength(3));
  const roster = (): { players: Record<string, { name: string }>; shares: Record<string, Record<string, string>> } =>
    JSON.parse(vault.files.get('atlas-vtt/players.json') ?? '{"players":{},"shares":{}}') as never;

  fireEvent.click(screen.getByRole('button', { name: 'New player…' }));
  const playerDialog = await screen.findByRole('dialog', { name: 'New player' });
  fireEvent.change(within(playerDialog).getByLabelText('Name'), { target: { value: 'Ana' } });
  fireEvent.click(within(playerDialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(Object.values(roster().players).map((player) => player.name)).toEqual(['Ana']));
  const [ana] = Object.keys(roster().players);

  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Fireball' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Goblin' }));
  fireEvent.click(within(screen.getByRole('toolbar', { name: '2 entries selected' })).getByRole('button', { name: 'Share 2 pages…' }));
  const shareDialog = await screen.findByRole('dialog', { name: 'Share 2 pages' });
  fireEvent.change(within(shareDialog).getByRole('combobox', { name: 'What Ana gets' }), { target: { value: 'read' } });
  fireEvent.click(within(shareDialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(roster().shares).toEqual({ [at('Spells/Fireball.md')]: { [ana ?? '']: 'read' }, [at('Monsters/Goblin.md')]: { [ana ?? '']: 'read' } }));

  // One page then: the GM lets Ana change the Fireball.
  fireEvent.click(row(/Fireball/));
  const sharedLine = (): string | null | undefined => document.querySelector('.atlas-compendium-preview__shared')?.textContent;
  await waitFor(() => expect(sharedLine()).toBe('Shared with Ana (read)'));
  fireEvent.click(within(document.querySelector('.atlas-compendium-preview') as HTMLElement).getByRole('button', { name: 'Share…' }));
  const oneDialog = await screen.findByRole('dialog', { name: 'Share Fireball' });
  fireEvent.change(within(oneDialog).getByRole('combobox', { name: 'What Ana gets' }), { target: { value: 'write' } });
  fireEvent.click(within(oneDialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(sharedLine()).toBe('Shared with Ana (read and write)'));

  // Ana's pages alone.
  fireEvent.click(screen.getByRole('button', { name: /^Ana/ }));
  expect(rows()).toEqual(['Fireball', 'Goblin']);

  dialogs.confirmAction.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Ana' }));
  await waitFor(() => expect(roster()).toEqual(expect.objectContaining({ players: {}, shares: {} })));
  expect(rows()).toEqual(['Fireball', 'Goblin', 'SRD 5.1 attribution']);
});

it('copies ticked entries into a book of the GM\'s own, and deletes ticked entries at once', async () => {
  const id = await CompendiumService.forApp(vault.app).ensurePersonalBook({ id: 'dnd5e-2014', name: 'D&D 5e 2014' }, { id: 'personal', name: 'Personal' });
  campaigns.update('c-1', (entry) => ({ ...entry, sources: [ID, id] }));
  vault.app.saveLocalStorage('atlas-vtt:playing-campaign', 'c-1');
  renderPane();
  await waitFor(() => expect(rows()).toHaveLength(3));

  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Fireball' }));
  const bar = screen.getByRole('toolbar', { name: '1 entry selected' });
  fireEvent.click(within(bar).getByRole('button', { name: 'Copy 1 entry into a book of your own…' }));
  const copyDialog = await screen.findByRole('dialog', { name: 'Copy 1 entry' });
  fireEvent.click(within(copyDialog).getByRole('button', { name: 'Save' }));
  const copy = 'Compendium/D&D 5e 2014/Personal/Spells/Fireball.md';
  await waitFor(() => expect(vault.files.get(copy)).toContain('atlas-source: dnd5e-2014/personal'));
  expect(vault.files.get(at('Spells/Fireball.md'))).toContain('atlas-compendium: spell');
  // The list shows the book copied into: back to every book.
  fireEvent.click(screen.getByRole('button', { name: /^All books/ }));

  fireEvent.click(screen.getByRole('checkbox', { name: 'Select Goblin' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select SRD 5.1 attribution' }));
  dialogs.confirmAction.mockResolvedValueOnce(true);
  fireEvent.click(within(screen.getByRole('toolbar', { name: '2 entries selected' })).getByRole('button', { name: 'Delete 2 entries…' }));
  await waitFor(() => expect(vault.files.has(at('Monsters/Goblin.md'))).toBe(false));
  expect(vault.files.has(at('Attribution.md'))).toBe(false);
  expect(screen.queryByRole('toolbar', { name: /selected/ })).toBeNull();
});
