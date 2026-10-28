import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
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
    expect(screen.getByRole('heading', { name: 'Fireball' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.atlas-compendium-preview__note')?.textContent).toBe('- **Level**: 3\n- **Ritual**: No\n\nA bright streak.'));
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
    await waitFor(() => expect(campaigns.current().find((campaign) => campaign.id === 'c-1')?.sources).toEqual([ID, 'dnd5e-2014/homebrew']));
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
  expect(screen.getByText('1 source of this campaign is not in this vault.')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'New book…' }));
  const bookDialog = await screen.findByRole('dialog', { name: 'New book' });
  fireEvent.change(within(bookDialog).getByLabelText('Name of the book'), { target: { value: 'Homebrew' } });
  fireEvent.click(within(bookDialog).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByText('1 source of this campaign is not in this vault.')).toBeNull());
  expect(campaigns.current().find((campaign) => campaign.id === 'c-1')?.sources).toEqual([ID, 'dnd5e-2014/homebrew']);
});
